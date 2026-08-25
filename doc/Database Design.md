# IlliniRide: Stage 3 Database Implementation and Indexing

Team YAY  
Keshav Soni, Steve Aby Tonio, Harshita Ketharaman  
CS 411 - Database Systems, UIUC

## 1. Database Implementation

IlliniRide was implemented in MySQL 8+ using the relational schema developed in Stage 2. The database used for this stage is named `illiniride`. We implemented six core tables for the application: `Users`, `Vehicles`, `Cities`, `Rides`, `Bookings`, and `Reviews`.

To satisfy the project requirement for MySQL 8+ and to document the active database connection, the following screenshot shows the `SELECT VERSION();` and `SELECT DATABASE();` output from the MySQL console.

![MySQL version and active database](<stage3/db_version.png>)

### 1.1 DDL Commands

```sql
CREATE TABLE Users (
    user_id INT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(100) NOT NULL UNIQUE,
    phone VARCHAR(15),
    rating DECIMAL(2,1),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE Cities (
    city_id INT PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    state VARCHAR(50),
    latitude DECIMAL(9,6),
    longitude DECIMAL(9,6)
);

CREATE TABLE Vehicles (
    vehicle_id INT PRIMARY KEY,
    user_id INT NOT NULL,
    make VARCHAR(50),
    model VARCHAR(50),
    year INT,
    color VARCHAR(30),
    license_plate VARCHAR(15),
    total_seats INT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES Users(user_id)
);

CREATE TABLE Rides (
    ride_id INT PRIMARY KEY,
    driver_id INT NOT NULL,
    vehicle_id INT NOT NULL,
    origin_city_id INT NOT NULL,
    destination_city_id INT NOT NULL,
    departure_time DATETIME,
    arrival_time DATETIME,
    price_per_seat DECIMAL(6,2),
    suggested_price DECIMAL(6,2),
    status ENUM('scheduled','ongoing','completed','cancelled') DEFAULT 'scheduled',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (driver_id) REFERENCES Users(user_id),
    FOREIGN KEY (vehicle_id) REFERENCES Vehicles(vehicle_id),
    FOREIGN KEY (origin_city_id) REFERENCES Cities(city_id),
    FOREIGN KEY (destination_city_id) REFERENCES Cities(city_id)
);

CREATE TABLE Bookings (
    booking_id INT PRIMARY KEY,
    ride_id INT NOT NULL,
    rider_id INT NOT NULL,
    seats_booked INT NOT NULL,
    total_price DECIMAL(6,2),
    status ENUM('confirmed','cancelled') DEFAULT 'confirmed',
    booked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (ride_id) REFERENCES Rides(ride_id),
    FOREIGN KEY (rider_id) REFERENCES Users(user_id)
);

CREATE TABLE Reviews (
    review_id INT PRIMARY KEY,
    booking_id INT NOT NULL,
    reviewer_id INT NOT NULL,
    reviewee_id INT NOT NULL,
    rating INT,
    comment TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (booking_id) REFERENCES Bookings(booking_id),
    FOREIGN KEY (reviewer_id) REFERENCES Users(user_id),
    FOREIGN KEY (reviewee_id) REFERENCES Users(user_id),
    CHECK (rating BETWEEN 1 AND 5)
);
```

### 1.2 Data Loading

We populated the database using CSV files stored in the repository's `data/` folder. `Users` and `Vehicles` were imported directly from the provided CSV files. The raw city and ride-related datasets required cleaning before import:

- `uscities.csv` was transformed into `cities_clean.csv` so that it matched the `Cities(city_id, name, state, latitude, longitude)` schema.
- `uber_rides_final.csv` contained incomplete rows, inconsistent status values, and decimal-form city IDs. It was cleaned into `rides_clean.csv`.
- `bookings.csv` and `reviews.csv` were filtered into `bookings_clean.csv` and `reviews_clean.csv` so that all foreign key references matched the cleaned `Rides` and `Users` data.

This approach allowed us to keep the relational schema from Stage 2 while ensuring referential integrity during import.

### 1.3 Row Counts After Import

The following count queries were used to verify successful insertion and to satisfy the requirement that at least three tables contain 1000+ rows.

```sql
SELECT COUNT(*) AS users_count FROM Users;
SELECT COUNT(*) AS vehicles_count FROM Vehicles;
SELECT COUNT(*) AS cities_count FROM Cities;
SELECT COUNT(*) AS rides_count FROM Rides;
SELECT COUNT(*) AS bookings_count FROM Bookings;
SELECT COUNT(*) AS reviews_count FROM Reviews;
```

| Table | Row Count |
|---|---:|
| Users | 1000 |
| Vehicles | 1000 |
| Cities | 28338 |
| Rides | 677 |
| Bookings | 1682 |
| Reviews | 977 |

`Users`, `Vehicles`, `Cities`, and `Bookings` all exceed the 1000-row threshold, so the data volume requirement is satisfied.

### 1.4 Count Verification Screenshot

The following screenshot should show the MySQL console output for the table count queries listed above. This is included to document that the database contains at least 1000 rows in multiple tables, as required by the rubric.

![Row count verification](<stage3/counts.png>)

## 2. Advanced SQL Queries

The project specification requested at least three advanced queries, while the rubric later referenced four. To avoid ambiguity and maximize completeness, we implemented four advanced queries. Each query uses at least two advanced SQL concepts such as multi-table joins, aggregation with `GROUP BY`, `HAVING`, and subqueries.

### 2.1 Query 1: Ride Search with Real-Time Seat Availability

This query models the core ride-search feature of IlliniRide. It finds rides on a specific route and computes remaining seat availability in real time by subtracting confirmed booked seats from the vehicle's total capacity. This directly follows one of the project's key design rules: available seats are computed, never stored.

```sql
SELECT
    r.ride_id,
    u.name AS driver_name,
    u.rating AS driver_rating,
    c1.name AS origin,
    c2.name AS destination,
    r.departure_time,
    r.price_per_seat,
    (v.total_seats - COALESCE(SUM(CASE WHEN b.status = 'confirmed' THEN b.seats_booked ELSE 0 END), 0)) AS available_seats
FROM Rides r
JOIN Users u ON r.driver_id = u.user_id
JOIN Cities c1 ON r.origin_city_id = c1.city_id
JOIN Cities c2 ON r.destination_city_id = c2.city_id
JOIN Vehicles v ON r.vehicle_id = v.vehicle_id
LEFT JOIN Bookings b ON r.ride_id = b.ride_id
WHERE r.origin_city_id = 118
  AND r.destination_city_id = 228
  AND r.status = 'completed'
GROUP BY
    r.ride_id, u.name, u.rating, c1.name, c2.name,
    r.departure_time, r.price_per_seat, v.total_seats
HAVING available_seats > 0
ORDER BY r.departure_time DESC
LIMIT 15;
```

Why it qualifies:
- Joins six relations/instances: `Rides`, `Users`, `Cities` twice, `Vehicles`, and `Bookings`
- Uses aggregation with `GROUP BY`
- Uses `HAVING` to filter by computed seat availability

![Query 1 output](<stage3/Query1.png>)

### 2.2 Query 2: Top Rated Drivers Above Platform Average

This query identifies drivers whose rating is at least the overall average user rating on the platform. It also groups their completed rides by route and computes ride counts and average price. This supports a "trusted drivers" feature and showcases a scalar subquery.

```sql
SELECT
    u.user_id,
    u.name AS driver_name,
    u.rating,
    c1.name AS origin,
    c2.name AS destination,
    COUNT(r.ride_id) AS total_rides,
    ROUND(AVG(r.price_per_seat), 2) AS avg_price
FROM Users u
JOIN Rides r ON u.user_id = r.driver_id
JOIN Cities c1 ON r.origin_city_id = c1.city_id
JOIN Cities c2 ON r.destination_city_id = c2.city_id
WHERE r.status = 'completed'
  AND u.rating >= (
      SELECT AVG(rating)
      FROM Users
      WHERE rating IS NOT NULL
  )
GROUP BY u.user_id, u.name, u.rating, c1.name, c2.name
ORDER BY u.rating DESC, total_rides DESC
LIMIT 15;
```

Why it qualifies:
- Uses multiple joins
- Uses aggregation with `GROUP BY`
- Uses a scalar subquery to compare each driver against the platform-wide average rating

![Query 2 output](<stage3/Query2.png>)

### 2.3 Query 3: Most Popular Routes by Bookings and Revenue

This query summarizes demand and revenue across routes. It counts distinct rides, total bookings, total seats filled, and total revenue for completed rides with confirmed bookings. This is useful for route analytics and for helping drivers understand which corridors are in highest demand.

```sql
SELECT
    c1.name AS origin,
    c2.name AS destination,
    COUNT(DISTINCT r.ride_id) AS total_rides,
    COUNT(b.booking_id) AS total_bookings,
    SUM(b.seats_booked) AS total_seats_filled,
    ROUND(SUM(b.total_price), 2) AS total_revenue,
    ROUND(AVG(r.price_per_seat), 2) AS avg_price_per_seat
FROM Rides r
JOIN Cities c1 ON r.origin_city_id = c1.city_id
JOIN Cities c2 ON r.destination_city_id = c2.city_id
JOIN Bookings b ON r.ride_id = b.ride_id
WHERE r.status = 'completed'
  AND b.status = 'confirmed'
GROUP BY c1.name, c2.name
HAVING COUNT(b.booking_id) >= 5
ORDER BY total_bookings DESC, total_revenue DESC
LIMIT 15;
```

Why it qualifies:
- Uses multiple joins
- Uses aggregation with `GROUP BY`
- Uses several aggregate functions in one query: `COUNT`, `COUNT(DISTINCT)`, `SUM`, and `AVG`

![Query 3 output](<stage3/Query3.png>)

### 2.4 Query 4: Price Deviation vs Booking Demand

This query supports the project's creative component. It compares a driver's chosen `price_per_seat` against the system-generated `suggested_price`, then measures how much booking activity that ride received. This helps analyze whether deviating from the suggested price affects demand.

```sql
SELECT
    r.ride_id,
    u.name AS driver_name,
    c1.name AS origin,
    c2.name AS destination,
    r.price_per_seat,
    r.suggested_price,
    ROUND(r.price_per_seat - r.suggested_price, 2) AS price_deviation,
    COUNT(CASE WHEN b.status = 'confirmed' THEN 1 END) AS confirmed_bookings,
    COALESCE(SUM(CASE WHEN b.status = 'confirmed' THEN b.seats_booked ELSE 0 END), 0) AS seats_filled
FROM Rides r
JOIN Users u ON r.driver_id = u.user_id
JOIN Cities c1 ON r.origin_city_id = c1.city_id
JOIN Cities c2 ON r.destination_city_id = c2.city_id
LEFT JOIN Bookings b ON r.ride_id = b.ride_id
WHERE r.status = 'completed'
  AND r.suggested_price IS NOT NULL
GROUP BY
    r.ride_id, u.name, c1.name, c2.name,
    r.price_per_seat, r.suggested_price
HAVING confirmed_bookings > 0
ORDER BY ABS(price_deviation) DESC, confirmed_bookings DESC
LIMIT 15;
```

Why it qualifies:
- Uses multiple joins
- Uses aggregation with `GROUP BY`
- Uses `HAVING` on a computed aggregate

![Query 4 output](<stage3/Query4.png>)

## 3. Indexing Analysis

For each advanced query, we first captured a baseline execution plan using `EXPLAIN ANALYZE`, then tested three isolated indexing designs. Following the course guidance, we focused on attributes used in `JOIN`, `WHERE`, `GROUP BY`, and `HAVING`. We evaluated each design primarily using the optimizer's estimated cost rather than wall-clock time.

An important observation from this stage is that our dataset is relatively small, and MySQL already made effective use of primary-key and foreign-key-related indexes. As a result, several additional indexes produced no meaningful gain and a few made the plans worse.

### 3.1 Query 1 Indexing

Baseline screenshot:

![Query 1 baseline explain](<stage3/Analyze_Q1.png>)

Index designs tested:

- Design 1: `CREATE INDEX idx_rides_origin_dest ON Rides(origin_city_id, destination_city_id);`
- Design 2: `CREATE INDEX idx_q1_rides_origin_dest_status ON Rides(origin_city_id, destination_city_id, status);`
- Design 3: `CREATE INDEX idx_q1_bookings_ride_status ON Bookings(ride_id, status);`

Supporting screenshots:

![Query 1 Design 1](<stage3/Q1_D1.png>)
![Query 1 Design 2](<stage3/Q1_D2.png>)
![Query 1 Design 3](<stage3/Q1_D3.png>)

| Query 1 Design | Estimated Cost | Observation |
|---|---:|---|
| Baseline | 10.7 | MySQL intersected existing indexes on `origin_city_id` and `destination_city_id` |
| Design 1 | 17.3 | Worse than baseline |
| Design 2 | 17.3 | Worse than baseline; optimizer still preferred the earlier route index |
| Design 3 | 17.3 | Worse than baseline; no meaningful gain from the bookings composite index |

Analysis: Query 1 filters on a very specific route and only touches 32 rides after filtering, so the baseline plan was already efficient. In the final baseline run, MySQL intersected separate indexes on `origin_city_id` and `destination_city_id`, then joined to the remaining tables. The additional composite indexes did not reduce the estimated cost and instead raised it from 10.7 to 17.3. Because the route filter is already highly selective on this dataset, the extra indexes added overhead without improving the plan. We therefore selected the baseline design and did not keep any additional query-specific index for Query 1.

### 3.2 Query 2 Indexing

Baseline screenshot:

![Query 2 baseline explain](<stage3/Analyze_Q2.png>)

Index designs tested:

- Design 1: `CREATE INDEX idx_q2_users_rating ON Users(rating);`
- Design 2: `CREATE INDEX idx_q2_rides_driver_status ON Rides(driver_id, status);`
- Design 3: both of the above indexes together

Supporting screenshots:

![Query 2 Design 1](<stage3/Q2_D1.png>)
![Query 2 Design 2](<stage3/Q2_D2.png>)
![Query 2 Design 3](<stage3/Q2_D3.png>)

| Query 2 Design | Estimated Cost | Observation |
|---|---:|---|
| Baseline | 168 | Best overall observed cost |
| Design 1 | 185 | Worse; only helped the subquery scan on `Users` |
| Design 2 | 168 | No improvement over baseline |
| Design 3 | 185 | Worse than baseline |

Analysis: Query 2 groups completed rides by driver and route after joining `Users`, `Rides`, and `Cities`. Indexing `Users(rating)` only improved the scalar subquery that computes the average user rating, but the outer query still scanned `Rides` and performed the same grouping work, so the total cost increased to 185. Indexing `Rides(driver_id, status)` produced essentially the same cost as the baseline because MySQL still chose a table scan on `Rides` for this workload. The combined design also increased the cost. Since the extra indexes did not improve the plan, the baseline remained the best final design for Query 2.

### 3.3 Query 3 Indexing

Baseline screenshot:

![Query 3 baseline explain](<stage3/Analyze_Q3.png>)

Index designs tested:

- Design 1: `CREATE INDEX idx_q3_bookings_status_ride ON Bookings(status, ride_id);`
- Design 2: `CREATE INDEX idx_q3_rides_status_route ON Rides(status, origin_city_id, destination_city_id);`
- Design 3: both of the above indexes together

Supporting screenshots:

![Query 3 Design 1](<stage3/Q3_D1.png>)
![Query 3 Design 2](<stage3/Q3_D2.png>)
![Query 3 Design 3](<stage3/Q3_D3.png>)

| Query 3 Design | Estimated Cost | Observation |
|---|---:|---|
| Baseline | 338 | Best reliable baseline |
| Design 1 | 306 | Lower cost, but the plan used a leftover bookings index from an earlier query experiment |
| Design 2 | 1002 | Much worse than baseline |
| Design 3 | 1002 | Much worse than baseline |

Analysis: Query 3 aggregates bookings and revenue by route, so `Bookings(status, ride_id)` initially appeared promising. However, the lowest-cost run for this query used `idx_q1_bookings_ride_status` in the actual plan rather than the newly created `idx_q3_bookings_status_ride`, which makes the improvement difficult to attribute cleanly. The route index on `Rides(status, origin_city_id, destination_city_id)` clearly made the plan worse, raising the cost to 1002, and the combined design was equally poor. Because the cleanest and most defensible result is the baseline plan, we chose not to keep any additional query-specific index for Query 3 and noted that the optimizer was already handling the joins efficiently with existing indexes.

### 3.4 Query 4 Indexing

Baseline screenshot:

![Query 4 baseline explain](<stage3/Analyze_Q4.png>)

Index designs tested:

- Design 1: `CREATE INDEX idx_q4_rides_status_suggested ON Rides(status, suggested_price);`
- Design 2: `CREATE INDEX idx_q4_bookings_ride_status ON Bookings(ride_id, status);`
- Design 3: both of the above indexes together

Supporting screenshots:

![Query 4 Design 1](<stage3/Q4_D1.png>)
![Query 4 Design 2](<stage3/Q4_D2.png>)
![Query 4 Design 3](<stage3/Q4_D3.png>)

| Query 4 Design | Estimated Cost | Observation |
|---|---:|---|
| Baseline | 364 | Best or tied-best observed cost |
| Design 1 | 1362 | Much worse than baseline |
| Design 2 | 364 | Same as baseline |
| Design 3 | 1362 | Much worse than baseline |

Analysis: Query 4 examines completed rides with non-null `suggested_price` and then aggregates booking demand by ride. The index on `Rides(status, suggested_price)` looked reasonable from the filter conditions alone, but in practice it made the cost much worse, increasing it from 364 to 1362. This indicates that the filter is not selective enough to outweigh the overhead of the new composite index on this dataset. Indexing `Bookings(ride_id, status)` produced the same cost as the baseline and therefore did not justify keeping an additional index. We selected the baseline design for Query 4 and concluded that MySQL's existing access paths were already sufficient.

## 4. Final Index Design Selection

After comparing all baseline and indexed plans, our final choice was to keep the default primary-key and foreign-key-related indexes and avoid adding extra query-specific indexes. The main reasons were:

- The dataset is modest in size, so table scans and simple index lookups were already inexpensive.
- Several tested indexes increased the optimizer's estimated cost.
- Some added indexes were not chosen by the optimizer even when they existed.
- In the few cases where cost appeared lower, the improvement could not be attributed cleanly to the new test index alone.

Overall, the indexing experiments were still valuable because they showed that index design must match the actual workload and data distribution. Adding indexes indiscriminately does not guarantee better performance, and on smaller datasets it can easily provide no benefit or even make the query plan worse.

## 5. Summary

In Stage 3, we successfully implemented the IlliniRide relational database in MySQL, loaded realistic and cleaned data into six main tables, and developed four advanced SQL queries aligned with the application's search, analytics, and pricing functionality. We also performed systematic indexing experiments with `EXPLAIN ANALYZE` and documented the performance tradeoffs. Although our additional indexes did not outperform the baseline plans, the analysis demonstrated a clear understanding of when indexes help, when they do not, and how to evaluate them using MySQL's optimizer output.
