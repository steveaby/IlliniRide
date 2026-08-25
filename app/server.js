const http = require("http");
const fs = require("fs");
const path = require("path");
const { URL } = require("url");
const { execFile } = require("child_process");

const PORT = Number(process.env.PORT || 3000);
const DB_HOST = process.env.DB_HOST || "127.0.0.1";
const DB_PORT = process.env.DB_PORT || "3306";
const DB_USER = process.env.DB_USER || "root";
const DB_PASSWORD = process.env.DB_PASSWORD || "";
const DB_NAME = process.env.DB_NAME || "illiniride";

const publicDir = path.join(__dirname, "public");

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function sendFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 500, { error: "Unable to load requested file." });
      return;
    }
    res.writeHead(200, { "Content-Type": contentType });
    res.end(data);
  });
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large."));
      }
    });
    req.on("end", () => resolve(raw));
    req.on("error", reject);
  });
}

function escapeSql(value) {
  return String(value)
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'");
}

function sqlString(value) {
  return `'${escapeSql(value)}'`;
}

function sqlNullableString(value) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return "NULL";
  }
  return sqlString(String(value).trim());
}

function sqlNullableNumber(value) {
  if (value === undefined || value === null || value === "") {
    return "NULL";
  }

  const number = Number(value);
  if (!Number.isFinite(number)) {
    return "NULL";
  }
  return String(number);
}

function parsePositiveInt(value) {
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function parseLimit(value, fallback = 10, max = 50) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    return fallback;
  }
  return Math.min(number, max);
}

function parseDateFilter(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) {
    return null;
  }
  return String(value);
}

function parseJsonBody(rawBody) {
  if (!rawBody) {
    return {};
  }
  return JSON.parse(rawBody);
}

function runMysqlQuery(sql) {
  const args = [
    "--protocol=TCP",
    "-h",
    DB_HOST,
    "-P",
    DB_PORT,
    "-u",
    DB_USER,
    DB_NAME,
    "--batch",
    "--raw",
    "-e",
    sql,
  ];

  return new Promise((resolve, reject) => {
    execFile(
      "mysql",
      args,
      {
        env: {
          ...process.env,
          MYSQL_PWD: DB_PASSWORD,
        },
        maxBuffer: 10 * 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(stderr || error.message));
          return;
        }
        resolve(stdout.trim());
      }
    );
  });
}

function parseTabular(stdout) {
  if (!stdout) {
    return [];
  }

  const lines = stdout.split("\n").filter(Boolean);
  if (lines.length === 0) {
    return [];
  }

  const headers = lines[0].split("\t");
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    const row = {};
    headers.forEach((header, index) => {
      row[header] = cells[index] ?? "";
    });
    return row;
  });
}

async function searchRides(origin, destination, date, seats, limit) {
  const safeOrigin = escapeSql(origin);
  const safeDestination = escapeSql(destination);
  const safeDate = parseDateFilter(date);
  const safeSeats = parsePositiveInt(seats) || 1;
  const safeLimit = parseLimit(limit, 10, 25);
  const dateClause = safeDate ? `AND DATE(r.departure_time) >= '${safeDate}'` : "";

  const sql = `
    SELECT
      r.ride_id,
      r.driver_id,
      c1.name AS origin,
      c2.name AS destination,
      u.name AS driver_name,
      u.rating AS driver_rating,
      r.departure_time,
      r.arrival_time,
      r.price_per_seat,
      r.suggested_price,
      r.status,
      CONCAT(v.color, ' ', v.make, ' ', v.model) AS vehicle,
      (v.total_seats - COALESCE(SUM(CASE WHEN b.status = 'confirmed' THEN b.seats_booked ELSE 0 END), 0)) AS available_seats
    FROM Rides r
    JOIN Users u ON r.driver_id = u.user_id
    JOIN Cities c1 ON r.origin_city_id = c1.city_id
    JOIN Cities c2 ON r.destination_city_id = c2.city_id
    JOIN Vehicles v ON r.vehicle_id = v.vehicle_id
    LEFT JOIN Bookings b ON r.ride_id = b.ride_id
    WHERE c1.name = '${safeOrigin}'
      AND c2.name = '${safeDestination}'
      AND r.status <> 'cancelled'
      ${dateClause}
    GROUP BY
      r.ride_id, r.driver_id, c1.name, c2.name, u.name, u.rating,
      r.departure_time, r.arrival_time, r.price_per_seat, r.suggested_price,
      r.status, v.color, v.make, v.model, v.total_seats
    HAVING available_seats >= ${safeSeats}
    ORDER BY r.departure_time ASC
    LIMIT ${safeLimit};
  `;

  const stdout = await runMysqlQuery(sql);
  return parseTabular(stdout);
}

async function createUser(name, email, phone) {
  const safeName = escapeSql(name);
  const safeEmail = escapeSql(email);
  const safePhone = escapeSql(phone);

  const insertSql = `
    INSERT INTO Users (user_id, name, email, phone, rating, created_at)
    SELECT COALESCE(MAX(user_id), 0) + 1, '${safeName}', '${safeEmail}', '${safePhone}', NULL, NOW()
    FROM Users;
  `;

  await runMysqlQuery(insertSql);

  const selectSql = `
    SELECT user_id, name, email, phone, created_at
    FROM Users
    WHERE email = '${safeEmail}'
    ORDER BY user_id DESC
    LIMIT 1;
  `;

  const stdout = await runMysqlQuery(selectSql);
  const rows = parseTabular(stdout);
  return rows[0] || null;
}

async function findUser(userId, email) {
  const safeUserId = parsePositiveInt(userId);
  const safeEmail = email ? escapeSql(String(email).trim()) : "";

  if (!safeUserId && !safeEmail) {
    throw new Error("Provide a user ID or email.");
  }

  const whereClause = safeUserId
    ? `user_id = ${safeUserId}`
    : `email = '${safeEmail}'`;

  const stdout = await runMysqlQuery(`
    SELECT user_id, name, email, phone, rating, created_at
    FROM Users
    WHERE ${whereClause}
    LIMIT 1;
  `);
  const rows = parseTabular(stdout);
  return rows[0] || null;
}

async function listBookings(limit, riderId) {
  const safeLimit = parseLimit(limit, 10, 50);
  const safeRiderId = parsePositiveInt(riderId);
  const whereClause = safeRiderId ? `WHERE b.rider_id = ${safeRiderId}` : "";

  const sql = `
    SELECT
      b.booking_id,
      b.ride_id,
      b.rider_id,
      rider.name AS rider_name,
      rider.email AS rider_email,
      r.driver_id,
      driver.name AS driver_name,
      driver.rating AS driver_rating,
      origin.name AS origin,
      destination.name AS destination,
      r.departure_time,
      r.arrival_time,
      r.status AS ride_status,
      b.seats_booked,
      b.total_price,
      b.status,
      b.booked_at,
      (v.total_seats - COALESCE(bt.confirmed_seats, 0)) AS current_available_seats
    FROM Bookings b
    JOIN Users rider ON b.rider_id = rider.user_id
    JOIN Rides r ON b.ride_id = r.ride_id
    JOIN Users driver ON r.driver_id = driver.user_id
    JOIN Cities origin ON r.origin_city_id = origin.city_id
    JOIN Cities destination ON r.destination_city_id = destination.city_id
    JOIN Vehicles v ON r.vehicle_id = v.vehicle_id
    LEFT JOIN (
      SELECT
        ride_id,
        SUM(CASE WHEN status = 'confirmed' THEN seats_booked ELSE 0 END) AS confirmed_seats
      FROM Bookings
      GROUP BY ride_id
    ) bt ON r.ride_id = bt.ride_id
    ${whereClause}
    ORDER BY b.booked_at DESC, b.booking_id DESC
    LIMIT ${safeLimit};
  `;

  const stdout = await runMysqlQuery(sql);
  return parseTabular(stdout);
}

async function getBooking(bookingId) {
  const sql = `
    SELECT
      b.booking_id,
      b.ride_id,
      b.rider_id,
      rider.name AS rider_name,
      r.driver_id,
      driver.name AS driver_name,
      driver.rating AS driver_rating,
      origin.name AS origin,
      destination.name AS destination,
      r.departure_time,
      r.arrival_time,
      r.status AS ride_status,
      b.seats_booked,
      b.total_price,
      b.status,
      b.booked_at
    FROM Bookings b
    JOIN Users rider ON b.rider_id = rider.user_id
    JOIN Rides r ON b.ride_id = r.ride_id
    JOIN Users driver ON r.driver_id = driver.user_id
    JOIN Cities origin ON r.origin_city_id = origin.city_id
    JOIN Cities destination ON r.destination_city_id = destination.city_id
    WHERE b.booking_id = ${bookingId};
  `;

  const stdout = await runMysqlQuery(sql);
  const rows = parseTabular(stdout);
  return rows[0] || null;
}

async function bookRide(rideId, riderId, seatsRequested) {
  const sql = `CALL sp_book_ride_transaction(${rideId}, ${riderId}, ${seatsRequested});`;
  const stdout = await runMysqlQuery(sql);
  const rows = parseTabular(stdout);
  return rows[0] || null;
}

async function updateBooking(bookingId, seatsBooked, status) {
  const safeSeats = seatsBooked === undefined ? null : parsePositiveInt(seatsBooked);
  const safeStatus = status === undefined || status === null ? null : String(status).trim();
  const allowedStatuses = new Set(["confirmed", "cancelled"]);

  if (seatsBooked !== undefined && !safeSeats) {
    throw new Error("Seats booked must be a positive integer.");
  }

  if (safeStatus && !allowedStatuses.has(safeStatus)) {
    throw new Error("Booking status must be confirmed or cancelled.");
  }

  if (!safeSeats && !safeStatus) {
    throw new Error("Provide seatsBooked, status, or both.");
  }

  const availabilitySql = `
    SELECT
      b.booking_id,
      b.seats_booked AS current_seats,
      b.status AS current_status,
      r.price_per_seat,
      v.total_seats,
      COALESCE(SUM(
        CASE
          WHEN other_b.status = 'confirmed'
            AND other_b.booking_id <> b.booking_id
          THEN other_b.seats_booked
          ELSE 0
        END
      ), 0) AS other_confirmed_seats
    FROM Bookings b
    JOIN Rides r ON b.ride_id = r.ride_id
    JOIN Vehicles v ON r.vehicle_id = v.vehicle_id
    LEFT JOIN Bookings other_b ON r.ride_id = other_b.ride_id
    WHERE b.booking_id = ${bookingId}
    GROUP BY b.booking_id, b.seats_booked, b.status, r.price_per_seat, v.total_seats;
  `;

  const availabilityRows = parseTabular(await runMysqlQuery(availabilitySql));
  const booking = availabilityRows[0];
  if (!booking) {
    return null;
  }

  const nextSeats = safeSeats || Number(booking.current_seats);
  const nextStatus = safeStatus || booking.current_status;
  const availableIfConfirmed =
    Number(booking.total_seats) - Number(booking.other_confirmed_seats);

  if (nextStatus === "confirmed" && nextSeats > availableIfConfirmed) {
    throw new Error("Not enough available seats to update this booking.");
  }

  const assignments = [
    `seats_booked = ${nextSeats}`,
    `total_price = ROUND(${nextSeats} * r.price_per_seat, 2)`,
  ];

  if (safeStatus) {
    assignments.push(`b.status = ${sqlString(safeStatus)}`);
  }

  const updateSql = `
    UPDATE Bookings b
    JOIN Rides r ON b.ride_id = r.ride_id
    SET ${assignments.join(", ")}
    WHERE b.booking_id = ${bookingId};
  `;

  await runMysqlQuery(updateSql);
  return getBooking(bookingId);
}

async function deleteBooking(bookingId) {
  const existingBooking = await getBooking(bookingId);
  if (!existingBooking) {
    return null;
  }

  await runMysqlQuery(`DELETE FROM Bookings WHERE booking_id = ${bookingId};`);
  return existingBooking;
}

async function postRideWithSuggestedPrice(body) {
  const driverId = parsePositiveInt(body.driverId);
  const vehicleId = parsePositiveInt(body.vehicleId);
  let originCityId = parsePositiveInt(body.originCityId);
  let destinationCityId = parsePositiveInt(body.destinationCityId);

  if (!originCityId && body.originCity) {
    const originRows = parseTabular(await runMysqlQuery(`SELECT city_id FROM Cities WHERE name = '${escapeSql(body.originCity)}' LIMIT 1;`));
    if (originRows.length > 0) originCityId = Number(originRows[0].city_id);
  }

  if (!destinationCityId && body.destinationCity) {
    const destRows = parseTabular(await runMysqlQuery(`SELECT city_id FROM Cities WHERE name = '${escapeSql(body.destinationCity)}' LIMIT 1;`));
    if (destRows.length > 0) destinationCityId = Number(destRows[0].city_id);
  }

  if (!driverId || !vehicleId || !originCityId || !destinationCityId) {
    throw new Error("driverId, vehicleId, origin city, and destination city are required. Ensure valid cities are provided.");
  }

  const sql = `
    CALL sp_post_ride_with_suggested_price(
      ${driverId},
      ${vehicleId},
      ${originCityId},
      ${destinationCityId},
      ${sqlNullableString(body.departureTime)},
      ${sqlNullableString(body.arrivalTime)},
      ${sqlNullableNumber(body.pricePerSeat)}
    );
  `;

  const stdout = await runMysqlQuery(sql);
  const rows = parseTabular(stdout);
  return rows[0] || null;
}

async function createReview(body) {
  const bookingId = parsePositiveInt(body.bookingId);
  const reviewerId = parsePositiveInt(body.reviewerId);
  const revieweeId = parsePositiveInt(body.revieweeId);
  const rating = parsePositiveInt(body.rating);
  const comment = (body.comment || "").trim();

  if (!bookingId || !reviewerId || !revieweeId || !rating || rating > 5) {
    throw new Error("bookingId, reviewerId, revieweeId, and rating from 1 to 5 are required.");
  }

  const idRows = parseTabular(
    await runMysqlQuery("SELECT COALESCE(MAX(review_id), 0) + 1 AS next_review_id FROM Reviews;")
  );
  const reviewId = Number(idRows[0].next_review_id);

  const insertSql = `
    INSERT INTO Reviews (
      review_id,
      booking_id,
      reviewer_id,
      reviewee_id,
      rating,
      comment,
      created_at
    )
    VALUES (
      ${reviewId},
      ${bookingId},
      ${reviewerId},
      ${revieweeId},
      ${rating},
      ${sqlString(comment)},
      NOW()
    );
  `;

  await runMysqlQuery(insertSql);

  const selectSql = `
    SELECT
      rv.review_id,
      rv.booking_id,
      rv.reviewer_id,
      reviewer.name AS reviewer_name,
      rv.reviewee_id,
      reviewee.name AS reviewee_name,
      rv.rating,
      rv.comment,
      rv.created_at,
      reviewee.rating AS updated_reviewee_rating
    FROM Reviews rv
    JOIN Users reviewer ON rv.reviewer_id = reviewer.user_id
    JOIN Users reviewee ON rv.reviewee_id = reviewee.user_id
    WHERE rv.review_id = ${reviewId};
  `;

  const rows = parseTabular(await runMysqlQuery(selectSql));
  return rows[0] || null;
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);
  const bookingMatch = parsedUrl.pathname.match(/^\/api\/bookings\/(\d+)$/);

  if (req.method === "GET" && parsedUrl.pathname === "/") {
    sendFile(res, path.join(publicDir, "index.html"), "text/html; charset=utf-8");
    return;
  }

  if (req.method === "GET" && parsedUrl.pathname === "/styles.css") {
    sendFile(res, path.join(publicDir, "styles.css"), "text/css; charset=utf-8");
    return;
  }

  if (req.method === "GET" && parsedUrl.pathname === "/app.js") {
    sendFile(res, path.join(publicDir, "app.js"), "application/javascript; charset=utf-8");
    return;
  }

  if (req.method === "GET" && parsedUrl.pathname === "/api/health") {
    sendJson(res, 200, {
      ok: true,
      database: DB_NAME,
      host: DB_HOST,
      port: DB_PORT,
    });
    return;
  }

  if (req.method === "GET" && parsedUrl.pathname === "/api/rides/search") {
    try {
      const origin = parsedUrl.searchParams.get("origin") || "";
      const destination = parsedUrl.searchParams.get("destination") || "";
      const date = parsedUrl.searchParams.get("date") || "";
      const seats = parsedUrl.searchParams.get("seats") || "1";
      const limit = Number(parsedUrl.searchParams.get("limit") || "10");

      if (!origin || !destination) {
        sendJson(res, 400, { error: "Origin and destination are required." });
        return;
      }

      const rides = await searchRides(origin, destination, date, seats, limit);
      sendJson(res, 200, { rides });
    } catch (error) {
      sendJson(res, 500, {
        error: "Ride search failed. Check that MySQL is running and the DB_* env vars are correct.",
        details: error.message,
      });
    }
    return;
  }

  if (req.method === "POST" && parsedUrl.pathname === "/api/rides") {
    try {
      const rawBody = await readRequestBody(req);
      const body = parseJsonBody(rawBody);
      const ride = await postRideWithSuggestedPrice(body);

      sendJson(res, 201, {
        message: "Ride posted with database-generated suggested price.",
        ride,
      });
    } catch (error) {
      sendJson(res, 400, {
        error: "Posting a ride failed.",
        details: error.message,
      });
    }
    return;
  }

  if (req.method === "GET" && parsedUrl.pathname === "/api/bookings") {
    try {
      const bookings = await listBookings(
        parsedUrl.searchParams.get("limit") || "10",
        parsedUrl.searchParams.get("riderId")
      );
      sendJson(res, 200, { bookings });
    } catch (error) {
      sendJson(res, 500, {
        error: "Fetching bookings failed.",
        details: error.message,
      });
    }
    return;
  }

  if (req.method === "GET" && bookingMatch) {
    try {
      const bookingId = Number(bookingMatch[1]);
      const booking = await getBooking(bookingId);
      if (!booking) {
        sendJson(res, 404, { error: "Booking not found." });
        return;
      }
      sendJson(res, 200, { booking });
    } catch (error) {
      sendJson(res, 500, {
        error: "Fetching booking failed.",
        details: error.message,
      });
    }
    return;
  }

  if (req.method === "POST" && parsedUrl.pathname === "/api/bookings") {
    try {
      const rawBody = await readRequestBody(req);
      const body = parseJsonBody(rawBody);
      const rideId = parsePositiveInt(body.rideId);
      const riderId = parsePositiveInt(body.riderId);
      const seatsRequested = parsePositiveInt(body.seatsRequested);

      if (!rideId || !riderId || !seatsRequested) {
        sendJson(res, 400, {
          error: "rideId, riderId, and seatsRequested are required positive integers.",
        });
        return;
      }

      const booking = await bookRide(rideId, riderId, seatsRequested);
      sendJson(res, 201, {
        message: "Booking created through the serializable transaction.",
        booking,
      });
    } catch (error) {
      sendJson(res, 400, {
        error: "Creating a booking failed.",
        details: error.message,
      });
    }
    return;
  }

  if (req.method === "PATCH" && bookingMatch) {
    try {
      const rawBody = await readRequestBody(req);
      const body = parseJsonBody(rawBody);
      const bookingId = Number(bookingMatch[1]);
      const booking = await updateBooking(bookingId, body.seatsBooked, body.status);

      if (!booking) {
        sendJson(res, 404, { error: "Booking not found." });
        return;
      }

      sendJson(res, 200, {
        message: "Booking updated successfully.",
        booking,
      });
    } catch (error) {
      sendJson(res, 400, {
        error: "Updating a booking failed.",
        details: error.message,
      });
    }
    return;
  }

  if (req.method === "DELETE" && bookingMatch) {
    try {
      const bookingId = Number(bookingMatch[1]);
      const booking = await deleteBooking(bookingId);

      if (!booking) {
        sendJson(res, 404, { error: "Booking not found." });
        return;
      }

      sendJson(res, 200, {
        message: "Booking deleted successfully.",
        booking,
      });
    } catch (error) {
      sendJson(res, 400, {
        error: "Deleting a booking failed. If this booking has reviews, remove those first.",
        details: error.message,
      });
    }
    return;
  }

  if (req.method === "POST" && parsedUrl.pathname === "/api/reviews") {
    try {
      const rawBody = await readRequestBody(req);
      const body = parseJsonBody(rawBody);
      const review = await createReview(body);

      sendJson(res, 201, {
        message: "Review created. The trigger recalculated the reviewee rating.",
        review,
      });
    } catch (error) {
      sendJson(res, 400, {
        error: "Creating a review failed.",
        details: error.message,
      });
    }
    return;
  }

  if (req.method === "GET" && parsedUrl.pathname === "/api/users/lookup") {
    try {
      const user = await findUser(
        parsedUrl.searchParams.get("userId"),
        parsedUrl.searchParams.get("email")
      );

      if (!user) {
        sendJson(res, 404, { error: "User not found." });
        return;
      }

      sendJson(res, 200, { user });
    } catch (error) {
      sendJson(res, 400, {
        error: "Looking up the user failed.",
        details: error.message,
      });
    }
    return;
  }

  if (req.method === "POST" && parsedUrl.pathname === "/api/users") {
    try {
      const rawBody = await readRequestBody(req);
      const body = parseJsonBody(rawBody);
      const name = (body.name || "").trim();
      const email = (body.email || "").trim();
      const phone = (body.phone || "").trim();

      if (!name || !email) {
        sendJson(res, 400, { error: "Name and email are required." });
        return;
      }

      const createdUser = await createUser(name, email, phone);
      sendJson(res, 201, {
        message: "User created successfully.",
        user: createdUser,
      });
    } catch (error) {
      sendJson(res, 500, {
        error: "Creating a user failed. Check that the email is unique and the DB_* env vars are correct.",
        details: error.message,
      });
    }
    return;
  }

  if (req.method === "GET" && parsedUrl.pathname === "/api/rides/driver") {
    try {
      const driverId = parsePositiveInt(parsedUrl.searchParams.get("driverId"));
      if (!driverId) {
        sendJson(res, 400, { error: "driverId is required." });
        return;
      }
      const sql = `
        SELECT
          r.ride_id,
          origin.name AS origin,
          destination.name AS destination,
          r.departure_time,
          r.arrival_time,
          r.price_per_seat,
          r.status,
          CONCAT(v.color, ' ', v.make, ' ', v.model) AS vehicle,
          (v.total_seats - COALESCE(SUM(CASE WHEN b.status = 'confirmed' THEN b.seats_booked ELSE 0 END), 0)) AS available_seats
        FROM Rides r
        JOIN Cities origin ON r.origin_city_id = origin.city_id
        JOIN Cities destination ON r.destination_city_id = destination.city_id
        JOIN Vehicles v ON r.vehicle_id = v.vehicle_id
        LEFT JOIN Bookings b ON r.ride_id = b.ride_id
        WHERE r.driver_id = ${driverId}
        GROUP BY r.ride_id, origin.name, destination.name, r.departure_time, r.arrival_time, r.price_per_seat, r.status, v.color, v.make, v.model, v.total_seats
        ORDER BY r.departure_time DESC;
      `;
      const stdout = await runMysqlQuery(sql);
      sendJson(res, 200, { rides: parseTabular(stdout) });
    } catch (error) {
      sendJson(res, 500, {
        error: "Fetching driver rides failed.",
        details: error.message,
      });
    }
    return;
  }

  if (req.method === "GET" && parsedUrl.pathname === "/api/vehicles") {
    try {
      const userId = parsePositiveInt(parsedUrl.searchParams.get("userId"));
      if (!userId) {
        sendJson(res, 400, { error: "userId is required." });
        return;
      }
      const sql = `SELECT vehicle_id, make, model, color FROM Vehicles WHERE user_id = ${userId}`;
      const stdout = await runMysqlQuery(sql);
      sendJson(res, 200, { vehicles: parseTabular(stdout) });
    } catch (error) {
      sendJson(res, 500, {
        error: "Fetching vehicles failed.",
        details: error.message,
      });
    }
    return;
  }

  sendJson(res, 404, { error: "Route not found." });
});

server.listen(PORT, () => {
  console.log(`IlliniRide server running at http://localhost:${PORT}`);
  console.log(`Using database ${DB_NAME} on ${DB_HOST}:${DB_PORT}`);
});
