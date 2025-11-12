const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();
const path= require('path');
const app = express();
const port = process.env.PORT || 3001;
const mimeTypes = require('mime-types');
// Middleware
app.use(cors());
app.use(express.json());

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});


pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});




app.get('/api/geofences', async (req, res) => {
  try {
  
  const result = await pool.query('SELECT id, name, lat, lng, radius_km * 1000 as radius, active, trucks, color FROM geofences ORDER BY id');

    const geofences = result.rows.map(row => {
      // trucks is now stored as bigint[]; ensure we return an array of numbers
      let trucks = row.trucks;
      if (!Array.isArray(trucks)) {
        trucks = [];
      } else {
        trucks = trucks.map(n => (typeof n === 'number' ? n : parseInt(n, 10))).filter(v => !Number.isNaN(v));
      }
      return { ...row, trucks };
    });
    res.json(geofences);
  } catch (error) {
    console.error('Error fetching geofences:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


app.get('/api/geofences/for-serial', async (req, res) => {
  // expects a numeric truck id in header `serial` (consider renaming to `truck_id`)
  const serial = req.headers.serial;
  const truckId = serial ? parseInt(serial, 10) : null;
  if (!truckId) return res.status(400).json({ error: 'Missing or invalid truck id in header `serial`' });
  try {
    const result = await pool.query(
      'SELECT id, name, lat, lng, radius_km * 1000 as radius FROM geofences WHERE $1 = ANY(trucks) ORDER BY id',
      [truckId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching geofences for truck id', truckId, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


app.post('/api/geofences', async (req, res) => {
  const { name, lat, lng, radius, active, trucks } = req.body;


  const rawRadiusKm = radius / 1000;

  const radiusKm = Math.round(rawRadiusKm * 100) / 100;

 
  const centrePoint = `POINT(${lng} ${lat})`;

  try {
    const result = await pool.query(
      'INSERT INTO geofences (name, lat, lng, radius_km, active, trucks, color, centre_point) VALUES ($1, $2, $3, $4, $5, $6, $7, ST_GeogFromText($8)) RETURNING id, name, lat, lng, radius_km * 1000 as radius, active, trucks, color',
      // pass trucks as JS array (will map to bigint[]). Caller must provide numbers.
      [name, lat, lng, radiusKm, active, trucks, generateRandomColor(), centrePoint]
    );

    const geofence = result.rows[0];
    const processedTrucks = Array.isArray(geofence.trucks) ? geofence.trucks.map(n => Number(n)).filter(v => !Number.isNaN(v)) : [];
    res.status(201).json({ ...geofence, trucks: processedTrucks });
  } catch (error) {
    console.error('Error creating geofence:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


app.put('/api/geofences/:id', async (req, res) => {
  const { id } = req.params;
  const { name, lat, lng, radius, active, trucks, color } = req.body;


  const rawRadiusKm = radius / 1000;

  const radiusKm = Math.round(rawRadiusKm * 100) / 100;


  const centrePoint = `POINT(${lng} ${lat})`;

  try {
    const result = await pool.query(
      'UPDATE geofences SET name = $1, lat = $2, lng = $3, radius_km = $4, active = $5, trucks = $6, color = $7, centre_point = ST_GeogFromText($8) WHERE id = $9 RETURNING id, name, lat, lng, radius_km * 1000 as radius, active, trucks, color',
      [name, lat, lng, radiusKm, active, trucks, color, centrePoint, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Geofence not found' });
    }


    const geofence = result.rows[0];
    const processedTrucks = Array.isArray(geofence.trucks) ? geofence.trucks.map(n => Number(n)).filter(v => !Number.isNaN(v)) : [];
    res.json({ ...geofence, trucks: processedTrucks });
  } catch (error) {
    console.error('Error updating geofence:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


app.delete('/api/geofences/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM geofences WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Geofence not found' });
    }

    res.json({ message: 'Geofence deleted successfully' });
  } catch (error) {
    console.error('Error deleting geofence:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


app.get('/api/trucks', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM vehicle_info order by id');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching trucks:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


function generateRandomColor() {
  const letters = '0123456789ABCDEF';
  let color = '#';
  for (let i = 0; i < 6; i++) {
    color += letters[Math.floor(Math.random() * 16)];
  }
  return color;
}

//Use the client app
app.use(express.static(path.join(__dirname, '/client/dist'), {
  setHeaders: (res, path) => {
    const mimeType = mimeTypes.lookup(path);
    console.log(`Path: ${path}, MimeType: ${mimeType}`);
    if (mimeType) {
      res.setHeader('Content-Type', mimeType);
    }
  }
}));
//Render client
//uodated client
app.get('*', (req, res)=>{

    res.sendFile(path.join(__dirname,'/client/dist/index.html'))
})





app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// Start server
app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  pool.end(() => {
    console.log('Database connection closed.');
    process.exit(0);
  });
});
