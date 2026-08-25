const state = {
  currentUser: JSON.parse(localStorage.getItem("illinirideUser") || "null"),
  lastSearch: null,
  selectedRide: null,
  selectedBooking: null,
};

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(payload.details || payload.error || "Request failed.");
  }
  return payload;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function money(value) {
  if (value === undefined || value === null || value === "") {
    return "N/A";
  }
  return `$${Number(value).toFixed(2)}`;
}

function shortDate(value) {
  if (!value) {
    return "Date not set";
  }
  return String(value).replace("T", " ").slice(0, 16);
}

function formValue(form, name) {
  return new FormData(form).get(name);
}

function setStatus(id, message, isError = false) {
  const element = document.getElementById(id);
  element.textContent = message || "";
  element.className = isError ? "status error" : "status";
}

function setView(name) {
  document.querySelectorAll(".view").forEach((view) => {
    view.classList.toggle("active", view.id === `view-${name}`);
  });

  document.querySelectorAll("[data-nav]").forEach((button) => {
    button.classList.toggle("active", button.dataset.nav === name);
  });

  if (name === "trips") {
    loadTrips();
  } else if (name === "offers") {
    loadOffers();
  } else if (name === "offer") {
    loadVehiclesForDriver();
  }
}

function saveCurrentUser(user) {
  state.currentUser = user;
  localStorage.setItem("illinirideUser", JSON.stringify(user));
  renderAccount();

  // Clear previous session's offer results
  const offerResult = document.getElementById("offer-result");
  const offerStatus = document.getElementById("offer-status");
  if (offerResult) offerResult.innerHTML = "";
  if (offerStatus) {
    offerStatus.textContent = "";
    offerStatus.className = "status";
  }

  // Refresh active views for the new user
  const offerView = document.getElementById("view-offer");
  if (offerView && offerView.classList.contains("active")) {
    loadVehiclesForDriver();
  }
  
  const tripsView = document.getElementById("view-trips");
  if (tripsView && tripsView.classList.contains("active")) {
    loadTrips();
  }

  const offersView = document.getElementById("view-offers");
  if (offersView && offersView.classList.contains("active")) {
    loadOffers();
  }
}

function renderAccount() {
  const chip = document.getElementById("account-chip");
  const driverInfo = document.getElementById("driver-info");
  
  if (!state.currentUser) {
    chip.textContent = "Continue as a rider";
    if (driverInfo) driverInfo.innerHTML = "Driver: <strong>Continue as a rider first</strong>";
    return;
  }

  chip.textContent = `${state.currentUser.name} · User #${state.currentUser.user_id}`;
  if (driverInfo) driverInfo.innerHTML = `Driver: <strong>${escapeHtml(state.currentUser.name)}</strong>`;
}

function renderEmpty(container, title, detail) {
  container.innerHTML = `
    <article class="empty-card">
      <h3>${escapeHtml(title)}</h3>
      <p>${escapeHtml(detail)}</p>
    </article>
  `;
}

function renderRideCards(rides) {
  const container = document.getElementById("ride-results");

  if (!rides.length) {
    renderEmpty(
      container,
      "No rides found",
      "Try a different date, reduce passengers, or search another route."
    );
    return;
  }

  container.innerHTML = rides
    .map(
      (ride) => `
        <article class="ride-card">
          <div>
            <p class="eyebrow">Ride #${escapeHtml(ride.ride_id)} · ${escapeHtml(ride.status)}</p>
            <h3>${escapeHtml(ride.origin)} to ${escapeHtml(ride.destination)}</h3>
            <p class="ride-time">${escapeHtml(shortDate(ride.departure_time))}</p>
            <p class="muted">Driver: ${escapeHtml(ride.driver_name)} · Rating ${escapeHtml(ride.driver_rating || "N/A")}</p>
            <p class="muted">${escapeHtml(ride.vehicle || "Vehicle details unavailable")}</p>
          </div>
          <div class="ride-side">
            <strong>${money(ride.price_per_seat)}</strong>
            <span>${escapeHtml(ride.available_seats)} seats left</span>
            <button type="button" data-book-ride="${escapeHtml(ride.ride_id)}">Book</button>
          </div>
        </article>
      `
    )
    .join("");

  document.querySelectorAll("[data-book-ride]").forEach((button) => {
    button.addEventListener("click", () => {
      const ride = rides.find((item) => item.ride_id === button.dataset.bookRide);
      openBooking(ride);
    });
  });
}

function openBooking(ride) {
  state.selectedRide = ride;
  const seats = state.lastSearch?.seats || "1";
  const container = document.getElementById("booking-detail");

  container.innerHTML = `
    <div class="route-line">
      <span>${escapeHtml(ride.origin)}</span>
      <span></span>
      <span>${escapeHtml(ride.destination)}</span>
    </div>
    <h3>${escapeHtml(shortDate(ride.departure_time))}</h3>
    <p class="muted">Driver ${escapeHtml(ride.driver_name)} · Rating ${escapeHtml(ride.driver_rating || "N/A")}</p>
    <p class="muted">${escapeHtml(ride.vehicle || "Vehicle details unavailable")}</p>
    <div class="summary-row">
      <span>${escapeHtml(seats)} passenger(s)</span>
      <strong>${money(Number(ride.price_per_seat) * Number(seats))}</strong>
    </div>
    <button id="confirm-booking" type="button">Confirm booking</button>
  `;

  document.getElementById("confirm-booking").addEventListener("click", confirmBooking);
  setStatus("booking-status", "");
  setView("booking");
}

async function confirmBooking() {
  if (!state.currentUser) {
    setStatus("booking-status", "Please continue as a rider before booking.", true);
    return;
  }

  try {
    const payload = await requestJson("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        rideId: state.selectedRide.ride_id,
        riderId: state.currentUser.user_id,
        seatsRequested: state.lastSearch?.seats || 1,
      }),
    });

    setStatus("booking-status", `Booked successfully. Booking #${payload.booking.booking_id}`);
    await loadTrips();
    setTimeout(() => setView("trips"), 500);
  } catch (error) {
    setStatus("booking-status", error.message, true);
  }
}

async function loadTrips() {
  const container = document.getElementById("trips-list");
  if (!state.currentUser) {
    renderEmpty(container, "No rider selected", "Continue as a user first, then your bookings will appear here.");
    setStatus("trips-status", "");
    return;
  }

  setStatus("trips-status", "Loading your trips...");
  try {
    const payload = await requestJson(`/api/bookings?riderId=${state.currentUser.user_id}&limit=20`);
    setStatus("trips-status", `${payload.bookings.length} booking(s) found.`);
    renderTrips(payload.bookings);
  } catch (error) {
    setStatus("trips-status", error.message, true);
  }
}

function renderTrips(bookings) {
  const container = document.getElementById("trips-list");
  if (!bookings.length) {
    renderEmpty(container, "No trips yet", "Search for a ride and book a seat to see it here.");
    return;
  }

  container.innerHTML = bookings
    .map(
      (booking) => `
        <article class="trip-card">
          <div>
            <p class="eyebrow">Booking #${escapeHtml(booking.booking_id)} · ${escapeHtml(booking.status)}</p>
            <h3>${escapeHtml(booking.origin)} to ${escapeHtml(booking.destination)}</h3>
            <p class="muted">${escapeHtml(shortDate(booking.departure_time))}</p>
            <p class="muted">Driver: ${escapeHtml(booking.driver_name)} · Total ${money(booking.total_price)}</p>
          </div>
          <form class="trip-actions" data-update-booking="${escapeHtml(booking.booking_id)}">
            <input name="seatsBooked" type="number" min="1" max="8" value="${escapeHtml(booking.seats_booked)}" />
            <button type="submit">Update seats</button>
            <button type="button" class="ghost-button" data-cancel-booking="${escapeHtml(booking.booking_id)}">Cancel</button>
            <button type="button" data-review-booking="${escapeHtml(booking.booking_id)}">Review driver</button>
            <button type="button" class="danger-button" data-delete-booking="${escapeHtml(booking.booking_id)}">Delete</button>
          </form>
        </article>
      `
    )
    .join("");

  document.querySelectorAll("[data-update-booking]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await updateBooking(form.dataset.updateBooking, formValue(form, "seatsBooked"));
    });
  });

  document.querySelectorAll("[data-cancel-booking]").forEach((button) => {
    button.addEventListener("click", () => cancelBooking(button.dataset.cancelBooking));
  });

  document.querySelectorAll("[data-review-booking]").forEach((button) => {
    button.addEventListener("click", () => {
      const booking = bookings.find((item) => item.booking_id === button.dataset.reviewBooking);
      openReview(booking);
    });
  });

  document.querySelectorAll("[data-delete-booking]").forEach((button) => {
    button.addEventListener("click", () => deleteBooking(button.dataset.deleteBooking));
  });
}

async function updateBooking(bookingId, seatsBooked) {
  try {
    await requestJson(`/api/bookings/${bookingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ seatsBooked, status: "confirmed" }),
    });
    await loadTrips();
  } catch (error) {
    setStatus("trips-status", error.message, true);
  }
}

async function cancelBooking(bookingId) {
  try {
    await requestJson(`/api/bookings/${bookingId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "cancelled" }),
    });
    await loadTrips();
  } catch (error) {
    setStatus("trips-status", error.message, true);
  }
}

async function deleteBooking(bookingId) {
  try {
    await requestJson(`/api/bookings/${bookingId}`, {
      method: "DELETE",
    });
    await loadTrips();
  } catch (error) {
    setStatus("trips-status", error.message, true);
  }
}

async function loadVehiclesForDriver() {
  const select = document.getElementById("vehicle-select");
  if (!select) return;
  
  if (!state.currentUser) {
    select.innerHTML = '<option value="">Please log in first</option>';
    return;
  }

  try {
    select.innerHTML = '<option value="">Loading vehicles...</option>';
    const payload = await requestJson(`/api/vehicles?userId=${state.currentUser.user_id}`);
    
    if (!payload.vehicles || payload.vehicles.length === 0) {
      select.innerHTML = '<option value="">No vehicles found</option>';
      return;
    }
    
    select.innerHTML = payload.vehicles
      .map(v => `<option value="${escapeHtml(v.vehicle_id)}">${escapeHtml(v.color)} ${escapeHtml(v.make)} ${escapeHtml(v.model)}</option>`)
      .join("");
  } catch (error) {
    select.innerHTML = '<option value="">Error loading vehicles</option>';
    setStatus("offer-status", "Failed to load vehicles: " + error.message, true);
  }
}

function openReview(booking) {
  state.selectedBooking = booking;
  document.getElementById("review-context").innerHTML = `
    <h3>${escapeHtml(booking.origin)} to ${escapeHtml(booking.destination)}</h3>
    <p class="muted">Reviewing ${escapeHtml(booking.driver_name)} for booking #${escapeHtml(booking.booking_id)}</p>
  `;
  setStatus("review-status", "");
  setView("review");
}

async function submitReview(event) {
  event.preventDefault();
  if (!state.currentUser || !state.selectedBooking) {
    setStatus("review-status", "Choose a booking to review first.", true);
    return;
  }

  try {
    const payload = await requestJson("/api/reviews", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        bookingId: state.selectedBooking.booking_id,
        reviewerId: state.currentUser.user_id,
        revieweeId: state.selectedBooking.driver_id,
        rating: formValue(event.target, "rating"),
        comment: formValue(event.target, "comment"),
      }),
    });

    setStatus(
      "review-status",
      `Review saved. ${payload.review.reviewee_name}'s rating is now ${payload.review.updated_reviewee_rating}.`
    );
  } catch (error) {
    setStatus("review-status", error.message, true);
  }
}

async function runSearch(event) {
  event.preventDefault();
  const form = event.target;
  state.lastSearch = {
    origin: formValue(form, "origin"),
    destination: formValue(form, "destination"),
    date: formValue(form, "date"),
    seats: formValue(form, "seats"),
  };

  const params = new URLSearchParams({
    ...state.lastSearch,
    limit: "20",
  });

  setStatus("search-status", "Searching...");
  document.getElementById("ride-results").innerHTML = "";

  try {
    const payload = await requestJson(`/api/rides/search?${params.toString()}`);
    setStatus("search-status", `${payload.rides.length} ride(s) available.`);
    renderRideCards(payload.rides);
  } catch (error) {
    setStatus("search-status", error.message, true);
  }
}

async function continueAsUser(event) {
  event.preventDefault();
  const identifier = String(formValue(event.target, "identifier") || "").trim();
  const isId = /^\d+$/.test(identifier);
  const params = new URLSearchParams(isId ? { userId: identifier } : { email: identifier });

  try {
    const payload = await requestJson(`/api/users/lookup?${params.toString()}`);
    saveCurrentUser(payload.user);
    setStatus("account-status", `Continuing as ${payload.user.name}.`);
  } catch (error) {
    setStatus("account-status", error.message, true);
  }
}

async function signUp(event) {
  event.preventDefault();
  const form = event.target;
  const name = formValue(form, "name");
  const email = formValue(form, "email");
  const phone = formValue(form, "phone");

  try {
    const payload = await requestJson("/api/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, phone }),
    });
    saveCurrentUser(payload.user);
    setStatus("account-status", `Welcome, ${payload.user.name}.`);
    form.reset();
  } catch (error) {
    setStatus("account-status", error.message, true);
  }
}

async function offerRide(event) {
  event.preventDefault();
  const form = event.target;

  if (!state.currentUser) {
    setStatus("offer-status", "Please continue as a rider first.", true);
    return;
  }

  try {
    const payload = await requestJson("/api/rides", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        driverId: state.currentUser.user_id,
        vehicleId: formValue(form, "vehicleId"),
        originCity: formValue(form, "originCity"),
        destinationCity: formValue(form, "destinationCity"),
        departureTime: formValue(form, "departureTime"),
        arrivalTime: formValue(form, "arrivalTime"),
        pricePerSeat: formValue(form, "pricePerSeat"),
      }),
    });

    document.getElementById("offer-result").innerHTML = `
      <article class="detail-card">
        <h3>Ride #${escapeHtml(payload.ride.ride_id)} published</h3>
        <p class="muted">${escapeHtml(payload.ride.origin)} to ${escapeHtml(payload.ride.destination)}</p>
        <p>Suggested price: <strong>${money(payload.ride.suggested_price)}</strong></p>
      </article>
    `;
    setStatus("offer-status", payload.message);
  } catch (error) {
    setStatus("offer-status", error.message, true);
  }
}

async function loadOffers() {
  const container = document.getElementById("offers-list");
  if (!state.currentUser) {
    renderEmpty(container, "No driver selected", "Continue as a user first, then your published rides will appear here.");
    setStatus("offers-status", "");
    return;
  }

  setStatus("offers-status", "Loading your published rides...");
  try {
    const payload = await requestJson(`/api/rides/driver?driverId=${state.currentUser.user_id}`);
    setStatus("offers-status", `${payload.rides.length} ride(s) published.`);
    renderOffers(payload.rides);
  } catch (error) {
    setStatus("offers-status", error.message, true);
  }
}

function renderOffers(rides) {
  const container = document.getElementById("offers-list");
  if (!rides.length) {
    renderEmpty(container, "No rides published", "You haven't offered any rides yet. Go to 'Offer a ride' to get started.");
    return;
  }

  container.innerHTML = rides
    .map(
      (ride) => `
        <article class="trip-card">
          <div>
            <p class="eyebrow">Ride #${escapeHtml(ride.ride_id)} · ${escapeHtml(ride.status)}</p>
            <h3>${escapeHtml(ride.origin)} to ${escapeHtml(ride.destination)}</h3>
            <p class="muted">${escapeHtml(shortDate(ride.departure_time))} – ${escapeHtml(shortDate(ride.arrival_time))}</p>
            <p class="muted">${escapeHtml(ride.vehicle)} · ${money(ride.price_per_seat)} per seat</p>
          </div>
          <div class="ride-side">
            <span><strong>${escapeHtml(ride.available_seats)}</strong> open seats</span>
          </div>
        </article>
      `
    )
    .join("");
}

document.querySelectorAll("[data-nav]").forEach((button) => {
  button.addEventListener("click", (event) => {
    event.preventDefault();
    setView(button.dataset.nav);
  });
});

document.getElementById("login-form").addEventListener("submit", continueAsUser);
document.getElementById("signup-form").addEventListener("submit", signUp);
document.getElementById("search-form").addEventListener("submit", runSearch);
document.getElementById("refresh-trips").addEventListener("click", loadTrips);
document.getElementById("refresh-offers").addEventListener("click", loadOffers);
document.getElementById("review-form").addEventListener("submit", submitReview);
document.getElementById("offer-form").addEventListener("submit", offerRide);

renderAccount();
document.getElementById("search-form").dispatchEvent(new Event("submit"));
