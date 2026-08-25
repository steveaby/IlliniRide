# IlliniRide: A Campus Carpooling Platform for UIUC

---

## Project Summary

Commuting from UIUC to cities like Chicago, the O'Hare airport (ORD), or other destinations in the Midwest is a recurring challenge for students and faculty. Public transit options are limited, and solo rideshares like Uber can get expensive fast. IlliniRide solves this by connecting drivers heading out of campus with riders going the same way, letting them split the cost and make the trip together.

The platform lets drivers post rides with details like their vehicle, origin, destination, departure time, and price per seat. Riders can browse available rides, filter by date or destination, check seat availability, and instantly book a seat. The goal is to make carpooling from UIUC feel as easy and trustworthy as possible, starting with the most common routes like UIUC to ORD, Chicago, and surrounding cities.

---

## Creative Component

Our creative component is a **dynamic price suggestion system** for drivers posting a ride. When a driver enters their origin and destination cities, the application queries the database to retrieve the coordinates of both cities from our cities dataset, computes the distance between them, and suggests a fair price per seat based on a base rate per mile plus a fixed overhead fee.

This is non-trivial because it requires:
- Storing and querying geographic coordinate data from a real cities dataset
- Computing distance using the Haversine formula applied within or alongside a database query
- Dynamically returning a suggestion at ride-creation time based on live query results

The driver is free to accept or override the suggestion. This feature adds real value to the user experience while keeping the computation grounded in the database, which fits the scope of this course well. Future improvements could factor in toll data, demand patterns, and time-of-day pricing.

> **Note:** For the scope of this database project, we have chosen to store city coordinates directly in a `cities` table and compute distances using the Haversine formula through database queries. This keeps the creative component database-driven, which is the focus of this course. That said, the system is designed in a way that a third-party API like Google Maps or OSRM could be swapped in later for more precise driving distances without requiring any schema changes.

---

## Usefulness

There is currently no dedicated carpooling platform built specifically for the UIUC community. General options like BlaBlaCar exist but are not widely used in the US or tailored to campus life. Uber and Lyft are available but expensive for longer routes like UIUC to Chicago (~2.5 hours). Facebook groups and group chats are sometimes used informally but offer no structure, no seat management, and no trust layer.

IlliniRide fills this gap with a focused, structured platform. Here is what users can do:

**Simple features:**
- Register and manage a user profile
- Add one or more vehicles to their profile
- Post a ride with origin, destination, departure time, arrival time, and price per seat
- Browse and search rides by source and destination city
- Filter rides by date, available seats, and price
- Book one or more seats on a ride instantly
- View their booking history and posted rides

**Complex features:**
- Dynamic price suggestion at ride-posting time based on city distance pulled from the database
- Seat availability computed in real time from bookings (not stored statically)
- Ride status tracking (scheduled, ongoing, completed, cancelled)
- Mutual review system between drivers and riders after ride completion

---

## Realness: Data Sources

We are using two real datasets to seed the application:

**1. Uber Rides Dataset (Kaggle)**
- Source: Kaggle (Uber dataset with ride details)
- Format: CSV
- Usage: Used to populate the `rides` and `bookings` tables with realistic ride records including origin/destination, timestamps, and pricing
- Cardinality: 1000+ rows

**2. US Cities Dataset (simplemaps.com / Kaggle)**
- Source: simplemaps US Cities database (free tier)
- Format: CSV
- Columns include: city name, state, latitude, longitude, population
- Usage: Populates our `cities` table which drives the dynamic pricing feature and standardizes all origin/destination inputs
- Cardinality: 30,000+ cities (we will filter to relevant Midwest cities for our use case, still well over 1K rows)

**3. User data**
- Users will be synthetically generated using realistic names, emails, and phone numbers using a Python script (Faker library). This is supplemented by rider/driver references extracted from the Uber dataset.

---

## Functionality Description

### CRUD Operations

**Create:**
- A user registers with name, email, phone
- A driver adds a vehicle to their profile (make, model, year, color, license plate, total seats)
- A driver posts a ride (vehicle, origin city, destination city, departure time, arrival time, price per seat)
- A rider books a ride (selects number of seats, instant confirmation)
- A user leaves a review after a completed ride

**Read:**
- Search rides by origin city and destination city
- Filter results by date, available seats, price range
- View ride details including driver info, vehicle, and remaining seats
- View booking history for a rider
- View all rides posted by a driver
- View ratings and reviews for a user

**Update:**
- Driver updates ride status (e.g., mark as ongoing or completed)
- User updates profile information
- Driver updates ride details before departure (time, price) if no bookings yet

**Delete:**
- Driver cancels a ride (updates status to cancelled, notifies booked riders)
- Rider cancels a booking
- User removes a vehicle from their profile

### Key Search & Filter Queries
- Search: `origin_city = X AND destination_city = Y`
- Filter by date: `departure_time >= [selected date]`
- Filter by available seats: `total_seats - SUM(seats_booked) >= [requested seats]`
- Filter by max price: `price_per_seat <= [max price]`
- Sort by price, departure time

---

## Low-Fidelity UI Mockup

The UI follows a structure similar to BlaBlaCar. Below are the key screens:

```
+----------------------------------------------------+
|           IlliniRide         [Login] [Register]    |
+----------------------------------------------------+

========== HOME / SEARCH PAGE ==========
+----------------------------------------------------+
|  From: [___________]  To: [___________]            |
|  Date: [___________]  Seats: [1 v]  [Search]       |
+----------------------------------------------------+
|  Available Rides                                   |
|  +----------------------------------------------+ |
|  | Chicago -> ORD  |  Mar 5  9:00AM  | $15/seat | |
|  | Driver: Keshav  |  2 seats left   | [Book]   | |
|  +----------------------------------------------+ |
|  | Champaign -> Detroit | Mar 6 | $22/seat       | |
|  | Driver: Steve   |  3 seats left   | [Book]   | |
|  +----------------------------------------------+ |
+----------------------------------------------------+

========== POST A RIDE PAGE ==========
+----------------------------------------------------+
|  From: [___________]  To: [___________]            |
|  Departure: [date/time]   Arrival: [date/time]     |
|  Vehicle: [dropdown - My Cars]                     |
|  Seats available: [__]                             |
|  Price per seat: [__]  <-- Suggested: $18.50       |
|                              (based on distance)   |
|  [Post Ride]                                       |
+----------------------------------------------------+

========== RIDE DETAIL PAGE ==========
+----------------------------------------------------+
|  UIUC -> Chicago  |  Mar 5, 9:00 AM               |
|  Driver: Keshav Soni  ⭐ 4.8                       |
|  Vehicle: 2022 Honda Civic (White)                 |
|  Price: $15/seat  |  3 seats left                 |
|  [Book 1 seat v]  [Confirm Booking]                |
+----------------------------------------------------+

========== USER PROFILE PAGE ==========
+----------------------------------------------------+
|  Keshav Soni  |  ⭐ 4.8  |  12 rides              |
|  [My Rides]  [My Bookings]  [My Vehicles]          |
|  +-- Vehicles --------------------------------+    |
|  |  2022 Honda Civic - White - 4 seats       |    |
|  |  [Edit]  [Remove]                         |    |
|  |  [+ Add Vehicle]                          |    |
|  +-------------------------------------------+    |
+----------------------------------------------------+
```

---

## Project Work Distribution

| Task | Responsible |
|------|-------------|
| Database schema design & normalization | Keshav Soni |
| Data collection, cleaning, and seeding | Harshita Ketharaman |
| Backend API (rides, bookings endpoints) | Steve Aby Tonio |
| Backend API (users, vehicles, reviews endpoints) | Harshita Ketharaman |
| Dynamic pricing query & logic | Keshav Soni |
| Frontend: Search & Ride listing pages | Steve Aby Tonio |
| Frontend: Profile, Post Ride, Booking pages | Keshav Soni |
| ER/UML diagram and relational schema (Stage 2) | Harshita Ketharaman |
| Testing & integration | All members |

---

*Submitted by: Keshav Soni, Steve Aby Tonio, Harshita Ketharaman*  
*Team Name: YAY*  
*Course: CS 411 - Database Systems, UIUC*
