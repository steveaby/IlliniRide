# Stage 2 Revisions

## Change 1: Remove Foreign Keys from Conceptual UML Diagram

**Comment addressed:** "The current diagram incorrectly includes FKs in a conceptual UML diagram."

**What was changed:** In `doc/stage2_database_design.md`, the Entity-Relationship Diagram (conceptual UML) previously included foreign key attributes (marked with `FK`) inside entity boxes. These have been removed because a conceptual ER diagram should only represent entities, their own attributes, and relationships between entities. Foreign keys are an implementation detail that belongs in the logical/relational schema, not the conceptual model.

**Specific attributes removed from the ER diagram:**
- `VEHICLES`: removed `user_id FK` (the ownership relationship is captured by the "USERS owns VEHICLES" relationship line)
- `RIDES`: removed `driver_id FK`, `vehicle_id FK`, `origin_city_id FK`, `destination_city_id FK` (these are all captured by the relationship lines connecting RIDES to USERS, VEHICLES, and CITIES)
- `BOOKINGS`: removed `ride_id FK`, `rider_id FK` (captured by relationship lines to RIDES and USERS)
- `REVIEWS`: removed `booking_id FK`, `reviewer_id FK`, `reviewee_id FK` (captured by relationship lines to BOOKINGS and USERS)

**Note:** The Relational Schema section at the bottom of the document still correctly includes all foreign keys, as that section represents the logical schema where FK references are appropriate.
