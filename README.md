# NexLock Backend API

Node.js/Express backend for the NexLock geofencing system.

## Setup

1. Install dependencies:
```bash
npm install
```

2. Set up PostgreSQL database:
   - Create a PostgreSQL database named `nexlock`
   - Run the SQL script in `database.sql` to create tables and insert sample data

3. Configure environment variables:
   - Copy `.env` file and update the database credentials

4. Start the server:
```bash
npm start
```

For development with auto-restart:
```bash
npm run dev
```

## API Endpoints

### Geofences

- `GET /api/geofences` - Get all geofences
- `POST /api/geofences` - Create new geofence
- `PUT /api/geofences/:id` - Update geofence
- `DELETE /api/geofences/:id` - Delete geofence

### Trucks

- `GET /api/trucks` - Get all trucks

## Database Schema

### Geofences Table
- `id` (SERIAL PRIMARY KEY)
- `name` (VARCHAR)
- `lat` (DECIMAL)
- `lng` (DECIMAL)
- `radius` (INTEGER)
- `active` (BOOLEAN)
- `trucks` (JSONB)
- `color` (VARCHAR)
- `created_at` (TIMESTAMP)
- `updated_at` (TIMESTAMP)

### Trucks Table
- `id` (SERIAL PRIMARY KEY)
- `registration` (VARCHAR UNIQUE)
- `model` (VARCHAR)
- `capacity` (DECIMAL)
- `status` (VARCHAR)
- `current_lat` (DECIMAL)
- `current_lng` (DECIMAL)
- `last_seen` (TIMESTAMP)
- `created_at` (TIMESTAMP)
- `updated_at` (TIMESTAMP)
