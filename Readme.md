# Team040-YAY: IlliniRide

IlliniRide is a CS 411 database project for a campus carpooling platform. The
Stage 4 application connects a simple browser UI to the MySQL `illiniride`
database and demonstrates ride search, ride posting, booking management, and
review-based rating updates.

## Stage 4 Features

- Ride keyword search by origin and destination city.
- Full CRUD for the non-user `Bookings` table.
- Transaction-backed booking creation through `sp_book_ride_transaction`.
- Stored-procedure ride posting through `sp_post_ride_with_suggested_price`.
- Trigger-backed review creation through `trg_reviews_after_insert_update_user_rating`.
- Additional constraints for booking seats, prices, vehicle capacity, and duplicate confirmed bookings.
- Raw SQL/MySQL client integration only; no ORM is used.

## App Structure

```text
app/
├── public/
│   ├── app.js
│   ├── index.html
│   └── styles.css
└── server.js

doc/
├── stage4_advanced_database_programs.sql
├── stage1_proposal.md
├── stage2_database_design.md
└── Database Design.md
```

## Local Setup

Start MySQL and make sure the Stage 3 database is loaded as `illiniride`.

Apply the Stage 4 advanced database programs:

```bash
mysql --protocol=TCP -h 127.0.0.1 -P 3306 -u root < doc/stage4_advanced_database_programs.sql
```

If your local MySQL root user has a password, add `-p` to the command.

Start the app:

```bash
DB_HOST=127.0.0.1 DB_PORT=3306 DB_USER=root DB_PASSWORD= DB_NAME=illiniride npm start
```

Open the app:

```text
http://localhost:3000
```

## Demo Flow

1. Use **Search Rides** with `Modesto` to `Huntington Beach` to show keyword search and live availability.
2. Use **Post Ride** with the default values to call the stored procedure and show the generated suggested price.
3. Use **Create Booking** with the ride ID returned from Post Ride to call the serializable transaction.
4. Use **Read Bookings** to show joined booking, rider, driver, route, and availability data.
5. Use **Update Booking** to change seats from `1` to `2` and show the recalculated total price.
6. Use **Delete Booking** to remove the temporary booking row.
7. Use **Create Review** to insert a review and show the trigger-updated user rating.

For a clean demo, delete the temporary booking before deleting any temporary ride rows directly in MySQL.

## Useful Verification Commands

Check JavaScript syntax:

```bash
node --check app/server.js
node --check app/public/app.js
```

Check that advanced DB objects exist:

```sql
SELECT ROUTINE_NAME, ROUTINE_TYPE
FROM information_schema.ROUTINES
WHERE ROUTINE_SCHEMA = 'illiniride';

SELECT TRIGGER_NAME, EVENT_MANIPULATION, EVENT_OBJECT_TABLE
FROM information_schema.TRIGGERS
WHERE TRIGGER_SCHEMA = 'illiniride';
```

## Notes

- The backend calls the `mysql` command-line client with raw SQL. This keeps the implementation aligned with the course requirement to avoid ORMs.
- The default demo values assume the cleaned Stage 3 data is loaded, including user `31`, vehicle `1`, city `3` as Chicago, and city `4` as Miami.
- The required Stage 4 SQL code for the transaction, stored procedure, trigger, and constraints is in `doc/stage4_advanced_database_programs.sql`.
