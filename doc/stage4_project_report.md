# IlliniRide Stage 4 Project Reflection Report

Team YAY  
Keshav Soni, Steve Aby Tonio, Harshita Ketharaman  
CS 411 - Database Systems, UIUC

## 1. Project Direction Changes

Our final project stayed close to the original IlliniRide proposal: a campus
carpooling platform where drivers can post rides, riders can search for trips,
and users can book seats. The largest change was scope. The original proposal
described a fuller production-style app with login, profile management,
vehicle management, ride detail pages, booking history, and mutual reviews. For
the final checkpoint, we focused on the database-backed workflows that best
matched the Stage 4 rubric: ride search, ride posting with dynamic pricing,
Bookings CRUD, transaction-safe booking, and trigger-backed review ratings.

We also changed the interface from multiple polished product pages into a
single demo-oriented web application. This made the advanced database features
easier to show during the checkpoint demo while still supporting the core
IlliniRide user story.

## 2. Usefulness Achieved or Not Achieved

IlliniRide achieved the main usefulness goal from our proposal: it demonstrates
how students could find shared rides, see available seats, book a seat, and
use review ratings as a trust signal. The application is useful as a working
prototype because it connects real database records to user actions and avoids
hard-coded demo results.

The app does not yet achieve the full usefulness of a deployed carpooling
service. It does not include authentication, account-specific dashboards,
notifications, payment handling, or map-based driving estimates. The current
version is best understood as a functional database prototype rather than a
complete consumer product.

## 3. Schema and Data Source Changes

The final application uses the same six core tables from the earlier design:
`Users`, `Vehicles`, `Cities`, `Rides`, `Bookings`, and `Reviews`. We did not
replace the data sources. We continued using cleaned CSV data for users,
vehicles, cities, rides, bookings, and reviews.

The biggest data-related change was practical cleaning and filtering. The raw
ride, booking, and review files had to be cleaned so foreign key references
matched the final table contents. This allowed the loaded database to satisfy
referential integrity constraints and made the Stage 4 application reliable.

## 4. ER Diagram and Table Implementation Changes

Our original ER design already matched the final implementation well. The
main entities and relationships remained the same:

- A user can own many vehicles.
- A user can post many rides as a driver.
- A user can make many bookings as a rider.
- A ride has one vehicle, one driver, one origin city, and one destination city.
- A booking connects a rider to a ride.
- A review is associated with a booking and connects a reviewer to a reviewee.

The final implementation made some design choices more explicit. First,
available seats are still not stored directly; they are computed from vehicle
capacity minus confirmed booked seats. This is more suitable because it avoids
inconsistency between `Rides`, `Vehicles`, and `Bookings`. Second, `Users.rating`
is a derived value maintained by a trigger after reviews are inserted. This is
a useful denormalization because the UI can quickly show a user's current
rating while the authoritative review data remains in `Reviews`.

For Stage 4, we also added stronger constraints in SQL, including positive
booking seats, nonnegative booking totals, nonnegative ride prices, vehicle
seat capacity bounds, and a uniqueness constraint on `(ride_id, rider_id)` for
bookings. These constraints make the final schema more suitable than the
earlier version because they protect business rules directly inside the
database instead of relying only on frontend validation.

## 5. Functionalities Added or Removed

Added in the final application:

- A complete browser interface for Stage 4 demo workflows.
- Ride keyword search by origin and destination city.
- Full CRUD for `Bookings`, which is a non-user table.
- A stored procedure for posting rides with database-generated suggested prices.
- A transaction procedure for booking seats safely.
- A review creation flow that demonstrates a trigger updating user ratings.
- Documentation and a demo script in the README.

Removed or deferred from the original proposal:

- Full login and authentication.
- Separate user profile, vehicle management, and ride detail pages.
- Payment and notification features.
- Map-based or API-based driving distance calculation.
- A production-style multi-page interface.

We removed or deferred those features because Stage 4 grading emphasizes
database connectivity, CRUD, search, and advanced SQL programs. Concentrating
on those pieces led to a stronger final checkpoint demo.

## 6. Advanced Database Programs

Our advanced database programs complement IlliniRide by moving important
business logic into the database.

The transaction procedure, `sp_book_ride_transaction`, supports safe booking.
It uses `SERIALIZABLE` isolation, locks the target ride, computes confirmed
seat usage with joins and aggregation, rejects duplicate confirmed bookings,
and inserts a booking only when enough seats remain. This directly supports
the user-facing action of reserving a seat.

The stored procedure, `sp_post_ride_with_suggested_price`, supports ride
posting. It validates that the vehicle belongs to the driver, computes route
distance from city coordinates using the Haversine formula, optionally blends
in historical route pricing, and inserts the new ride. This implements our
creative component and helps drivers choose a reasonable price.

The trigger, `trg_reviews_after_insert_update_user_rating`, supports trust and
reputation. After a review is inserted, it recalculates the reviewed user's
average rating and updates `Users.rating`. This keeps the UI rating value in
sync with the underlying review records.

The constraints protect correctness. Primary and foreign keys enforce
relationships, while the added check and uniqueness constraints prevent
invalid seats, invalid prices, unrealistic vehicle capacities, and duplicate
confirmed bookings for the same rider and ride.

## 7. Technical Challenges

Keshav Soni: One challenge was implementing dynamic price suggestion inside
the database instead of relying on application-only logic. The Haversine
distance formula requires careful handling of latitude and longitude values,
and floating point rounding can sometimes push the input to `ACOS` slightly
outside the valid range. We handled this by clamping the value between `-1`
and `1` in the stored procedure. Future teams using geographic formulas in SQL
should test edge cases and not assume that mathematically valid expressions
always stay numerically valid in floating point execution.

Steve Aby Tonio: A challenge was designing the booking flow so it behaved like
a real reservation system instead of a simple insert. The application needs to
compute live seat availability from existing confirmed bookings and reject
overbooking. This is why the booking creation logic was moved into a database
transaction with a strict isolation level. Future teams should avoid storing
available seats as a static column unless they have a strong synchronization
strategy, because it is easy for stored seat counts to become stale.

Harshita Ketharaman: A challenge was preparing the dataset so that it loaded
cleanly into a normalized relational schema. The raw CSV files had inconsistent
values and references that did not always match the final tables. Cleaning the
data before import was necessary to preserve foreign key integrity. Future
teams should plan extra time for data validation and should check row counts,
foreign key matches, and invalid enum values before trying to build the UI.

## 8. Other Changes from Original Proposal

The final app became more database-demo oriented than the original product
mockup. Instead of hiding technical workflows behind a polished consumer UI,
we exposed the key database actions clearly: search, post ride, create
booking, read bookings, update booking, delete booking, and create review.
This was a deliberate choice because the final checkpoint is graded on
functionality and database integration, not visual polish.

We also kept the backend dependency-light. It uses Node's built-in HTTP module
and the MySQL command-line client rather than an ORM. This helped satisfy the
course requirement that advanced database features be implemented in SQL.

## 9. Future Work

Future work beyond interface improvements includes:

- Add authentication and role-aware sessions for riders and drivers.
- Add vehicle CRUD so drivers can manage multiple cars.
- Add ride cancellation logic that handles existing confirmed bookings.
- Add a stronger review policy so only valid ride participants can review each other.
- Replace straight-line distance with driving distance from a map or routing service.
- Add demand-aware pricing based on route popularity, day of week, and booking history.
- Add notification support for booking confirmation, cancellation, and ride changes.
- Host the application and database on GCP for a more realistic deployment.

## 10. Division of Labor and Teamwork

The final division of labor followed the earlier project plan. Keshav focused
on database schema design, dynamic pricing, frontend integration, and final
testing. Steve focused on backend ride and booking flows, including API
integration for the booking transaction. Harshita focused on data cleaning,
database loading, review/user-related backend work, and documentation support.
All members contributed to testing, debugging, and aligning the final
implementation with the project rubric.

Teamwork was managed by splitting the project around database, backend, data,
and frontend responsibilities, then integrating the pieces near the end. The
most important teamwork lesson was that database constraints and application
features need to be developed together. When the schema, advanced SQL programs,
and UI were tested as one flow, it became much easier to find mismatches and
turn the project into a complete application.

