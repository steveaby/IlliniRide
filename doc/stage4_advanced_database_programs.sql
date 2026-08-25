-- IlliniRide Stage 4 Advanced Database Programs
-- Team YAY
--
-- This file documents the transaction, stored procedure, trigger, and
-- additional constraints used by the Stage 4 application. It is intended to be
-- run after the Stage 3 schema and data have been loaded into the illiniride DB.

USE illiniride;

-- ---------------------------------------------------------------------------
-- Additional constraints
-- ---------------------------------------------------------------------------
-- The Stage 3 schema already defines primary keys and foreign keys. These
-- additional constraints protect application-level invariants used by the
-- booking and ride-posting workflows.

ALTER TABLE Vehicles
  ADD CONSTRAINT chk_vehicles_total_seats
  CHECK (total_seats BETWEEN 1 AND 8);

ALTER TABLE Bookings
  ADD CONSTRAINT chk_bookings_positive_seats
  CHECK (seats_booked > 0);

ALTER TABLE Bookings
  ADD CONSTRAINT chk_bookings_nonnegative_total
  CHECK (total_price >= 0);

ALTER TABLE Bookings
  ADD CONSTRAINT uq_bookings_ride_rider
  UNIQUE (ride_id, rider_id);

ALTER TABLE Rides
  ADD CONSTRAINT chk_rides_nonnegative_prices
  CHECK (
    price_per_seat >= 0
    AND (suggested_price IS NULL OR suggested_price >= 0)
  );

-- ---------------------------------------------------------------------------
-- Transaction feature: safely book seats on a ride
-- ---------------------------------------------------------------------------
-- Application utility:
--   Called when a rider confirms a booking. The transaction uses SERIALIZABLE
--   isolation, checks live seat availability, rejects duplicate bookings, and
--   inserts a confirmed booking only if the ride has enough open seats.
--
-- Advanced query coverage:
--   1. Ride availability query joins Rides, Vehicles, and Bookings and uses
--      GROUP BY aggregation to compute remaining seats.
--   2. Duplicate booking query joins Bookings and Rides, uses COUNT
--      aggregation, and includes a subquery that references the target ride.

DROP PROCEDURE IF EXISTS sp_book_ride_transaction;

DELIMITER //

CREATE PROCEDURE sp_book_ride_transaction(
  IN p_ride_id INT,
  IN p_rider_id INT,
  IN p_seats_requested INT
)
BEGIN
  DECLARE v_driver_id INT DEFAULT NULL;
  DECLARE v_price_per_seat DECIMAL(6,2) DEFAULT 0.00;
  DECLARE v_total_seats INT DEFAULT 0;
  DECLARE v_confirmed_seats INT DEFAULT 0;
  DECLARE v_available_seats INT DEFAULT 0;
  DECLARE v_existing_bookings INT DEFAULT 0;
  DECLARE v_new_booking_id INT DEFAULT 0;

  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  SET TRANSACTION ISOLATION LEVEL SERIALIZABLE;
  START TRANSACTION;

  IF p_seats_requested IS NULL OR p_seats_requested <= 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Seats requested must be greater than zero.';
  END IF;

  -- Lock the target ride row before computing availability.
  SELECT r.driver_id
    INTO v_driver_id
  FROM Rides r
  WHERE r.ride_id = p_ride_id
    AND r.status <> 'cancelled'
  FOR UPDATE;

  IF v_driver_id IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Ride does not exist or has been cancelled.';
  END IF;

  IF v_driver_id = p_rider_id THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Drivers cannot book seats on their own rides.';
  END IF;

  SELECT
      r.driver_id,
      r.price_per_seat,
      v.total_seats,
      COALESCE(SUM(CASE WHEN b.status = 'confirmed' THEN b.seats_booked ELSE 0 END), 0),
      v.total_seats
        - COALESCE(SUM(CASE WHEN b.status = 'confirmed' THEN b.seats_booked ELSE 0 END), 0)
    INTO
      v_driver_id,
      v_price_per_seat,
      v_total_seats,
      v_confirmed_seats,
      v_available_seats
  FROM Rides r
  JOIN Vehicles v ON r.vehicle_id = v.vehicle_id
  LEFT JOIN Bookings b ON r.ride_id = b.ride_id
  WHERE r.ride_id = p_ride_id
  GROUP BY r.driver_id, r.price_per_seat, v.total_seats;

  SELECT COUNT(*)
    INTO v_existing_bookings
  FROM Bookings b
  JOIN Rides r ON b.ride_id = r.ride_id
  WHERE b.rider_id = p_rider_id
    AND b.status = 'confirmed'
    AND b.ride_id IN (
      SELECT r2.ride_id
      FROM Rides r2
      WHERE r2.ride_id = p_ride_id
        AND r2.status <> 'cancelled'
    );

  IF v_existing_bookings > 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'This rider already has a confirmed booking for the ride.';
  END IF;

  IF v_available_seats < p_seats_requested THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Not enough available seats for this booking.';
  END IF;

  SELECT COALESCE(MAX(booking_id), 0) + 1
    INTO v_new_booking_id
  FROM Bookings;

  INSERT INTO Bookings (
    booking_id,
    ride_id,
    rider_id,
    seats_booked,
    total_price,
    status,
    booked_at
  )
  VALUES (
    v_new_booking_id,
    p_ride_id,
    p_rider_id,
    p_seats_requested,
    ROUND(p_seats_requested * v_price_per_seat, 2),
    'confirmed',
    NOW()
  );

  COMMIT;

  SELECT
    v_new_booking_id AS booking_id,
    p_ride_id AS ride_id,
    p_rider_id AS rider_id,
    p_seats_requested AS seats_booked,
    ROUND(p_seats_requested * v_price_per_seat, 2) AS total_price,
    v_available_seats - p_seats_requested AS seats_left_after_booking;
END//

DELIMITER ;

-- ---------------------------------------------------------------------------
-- Stored procedure feature: post a ride with dynamic price suggestion
-- ---------------------------------------------------------------------------
-- Application utility:
--   Called when a driver posts a ride. It computes a suggested price from city
--   coordinates, optionally blends in historical route pricing, validates the
--   driver/vehicle relationship, and inserts the new ride.
--
-- Advanced query coverage:
--   1. Self-join on Cities computes route distance using latitude/longitude.
--   2. Historical route query uses aggregation and a subquery to compute route
--      demand/pricing context.
--   Control structures:
--      IF statements validate inputs and choose whether to use the suggested
--      price or the driver-entered price.

DROP PROCEDURE IF EXISTS sp_post_ride_with_suggested_price;

DELIMITER //

CREATE PROCEDURE sp_post_ride_with_suggested_price(
  IN p_driver_id INT,
  IN p_vehicle_id INT,
  IN p_origin_city_id INT,
  IN p_destination_city_id INT,
  IN p_departure_time DATETIME,
  IN p_arrival_time DATETIME,
  IN p_price_per_seat DECIMAL(6,2)
)
BEGIN
  DECLARE v_vehicle_matches_driver INT DEFAULT 0;
  DECLARE v_distance_miles DECIMAL(8,2) DEFAULT NULL;
  DECLARE v_historical_avg_price DECIMAL(6,2) DEFAULT NULL;
  DECLARE v_suggested_price DECIMAL(6,2) DEFAULT 0.00;
  DECLARE v_final_price DECIMAL(6,2) DEFAULT 0.00;
  DECLARE v_new_ride_id INT DEFAULT 0;

  SELECT COUNT(*)
    INTO v_vehicle_matches_driver
  FROM Vehicles v
  JOIN Users u ON v.user_id = u.user_id
  WHERE v.vehicle_id = p_vehicle_id
    AND u.user_id = p_driver_id;

  IF v_vehicle_matches_driver = 0 THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Vehicle must belong to the driver posting the ride.';
  END IF;

  IF p_origin_city_id = p_destination_city_id THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Origin and destination must be different cities.';
  END IF;

  SELECT
      ROUND(
        3959 * ACOS(
          LEAST(
            1,
            GREATEST(
              -1,
              COS(RADIANS(origin.latitude))
              * COS(RADIANS(destination.latitude))
              * COS(RADIANS(destination.longitude) - RADIANS(origin.longitude))
              + SIN(RADIANS(origin.latitude))
              * SIN(RADIANS(destination.latitude))
            )
          )
        ),
        2
      )
    INTO v_distance_miles
  FROM Cities origin
  JOIN Cities destination ON destination.city_id = p_destination_city_id
  WHERE origin.city_id = p_origin_city_id;

  IF v_distance_miles IS NULL THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'Origin or destination city does not exist.';
  END IF;

  SELECT ROUND(AVG(r.price_per_seat), 2)
    INTO v_historical_avg_price
  FROM Rides r
  WHERE r.origin_city_id = p_origin_city_id
    AND r.destination_city_id = p_destination_city_id
    AND r.status IN ('scheduled', 'ongoing', 'completed')
    AND r.ride_id IN (
      SELECT b.ride_id
      FROM Bookings b
      WHERE b.status = 'confirmed'
      GROUP BY b.ride_id
      HAVING SUM(b.seats_booked) > 0
    );

  SET v_suggested_price = ROUND(2.00 + (v_distance_miles * 0.16), 2);

  IF v_historical_avg_price IS NOT NULL THEN
    SET v_suggested_price = ROUND((v_suggested_price + v_historical_avg_price) / 2, 2);
  END IF;

  IF p_price_per_seat IS NULL OR p_price_per_seat <= 0 THEN
    SET v_final_price = v_suggested_price;
  ELSE
    SET v_final_price = p_price_per_seat;
  END IF;

  SELECT COALESCE(MAX(ride_id), 0) + 1
    INTO v_new_ride_id
  FROM Rides;

  INSERT INTO Rides (
    ride_id,
    driver_id,
    vehicle_id,
    origin_city_id,
    destination_city_id,
    departure_time,
    arrival_time,
    price_per_seat,
    suggested_price,
    status,
    created_at
  )
  VALUES (
    v_new_ride_id,
    p_driver_id,
    p_vehicle_id,
    p_origin_city_id,
    p_destination_city_id,
    p_departure_time,
    p_arrival_time,
    v_final_price,
    v_suggested_price,
    'scheduled',
    NOW()
  );

  SELECT
    r.ride_id,
    driver.name AS driver_name,
    origin.name AS origin,
    destination.name AS destination,
    r.departure_time,
    r.arrival_time,
    r.price_per_seat,
    r.suggested_price
  FROM Rides r
  JOIN Users driver ON r.driver_id = driver.user_id
  JOIN Cities origin ON r.origin_city_id = origin.city_id
  JOIN Cities destination ON r.destination_city_id = destination.city_id
  WHERE r.ride_id = v_new_ride_id;
END//

DELIMITER ;

-- ---------------------------------------------------------------------------
-- Trigger feature: keep user ratings synchronized after reviews
-- ---------------------------------------------------------------------------
-- Application utility:
--   When a review is inserted, the reviewed user's average rating is
--   recalculated automatically. This keeps Users.rating consistent with the
--   Reviews table without requiring frontend code to maintain the derived value.
--
-- Trigger criteria:
--   Event: AFTER INSERT ON Reviews
--   Condition: IF NEW.rating BETWEEN 1 AND 5
--   Action: UPDATE Users.rating

DROP TRIGGER IF EXISTS trg_reviews_after_insert_update_user_rating;

DELIMITER //

CREATE TRIGGER trg_reviews_after_insert_update_user_rating
AFTER INSERT ON Reviews
FOR EACH ROW
BEGIN
  IF NEW.rating BETWEEN 1 AND 5 THEN
    UPDATE Users u
    SET u.rating = (
      SELECT ROUND(AVG(r.rating), 1)
      FROM Reviews r
      WHERE r.reviewee_id = NEW.reviewee_id
    )
    WHERE u.user_id = NEW.reviewee_id;
  END IF;
END//

DELIMITER ;
