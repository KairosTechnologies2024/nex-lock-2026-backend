require('dotenv').config();
const express = require('express');
const { Pool } = require('pg');

const app = express();
const port =  3001;


const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,

 
});


app.use(express.json());
app.use(express.urlencoded({ extended: true }));



app.get('/api/geofences/for-serial', async (req, res) => {

  const serial = req.headers.serial;
  const truckId = serial ? parseInt(serial, 10) : null;
  if (!truckId) return res.status(400).json({ error: 'Missing or invalid truck id in header `serial`' });
  try {
    const result = await pool.query(
      'SELECT id, lat, lng, radius_km as rad, shape, polygon_coords FROM geofences WHERE $1 = ANY(trucks) AND active = true ORDER BY id',
      [truckId]
    );

    const data = result.rows; 

    let dataMapped = data.map(row => {
      const shape = row.shape || 'circle';
      const polygon = Array.isArray(row.polygon_coords) ? row.polygon_coords : [];
      if (shape === 'polygon' && polygon.length > 0) {
    /*      return {
          id: row.id,
          lat: polygon.map(p => parseFloat(p.lat)),
          lng: polygon.map(p => parseFloat(p.lng)),
          rad: 0,
       
        };  */
      }
      return {
        id: row.id,
        lat: parseFloat(row.lat),
        lng: parseFloat(row.lng),
        rad: parseFloat(row.rad),
      
      };
    });
   

   // console.log('mapped data', dataMapped)
   // console.log(data);
    res.json(dataMapped);
  } catch (error) {
    console.error('Error fetching geofences for truck id', truckId, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});




app.get('/api/geofences/for-serial-test', async (req, res) => {

  const serial = req.headers.serial;
  const truckId = serial ? parseInt(serial, 10) : null;
  if (!truckId) return res.status(400).json({ error: 'Missing or invalid truck id in header `serial`' });
  try {
    const result = await pool.query(
      'SELECT id, lat, lng, radius_km as rad, shape, polygon_coords FROM geofences WHERE $1 = ANY(trucks) AND active = true ORDER BY id',
      [truckId]
    );

    const data = result.rows;

    let dataMapped = data.map(row => {
      const shape = row.shape || 'circle';
      const polygon = Array.isArray(row.polygon_coords) ? row.polygon_coords : [];
      if (shape === 'polygon' && polygon.length > 0) {
        return {
          id: row.id,
          lat: polygon.map(p => parseFloat(p.lat)),
          lng: polygon.map(p => parseFloat(p.lng)),
          rad: 0,

        };
      }
      return {
        id: row.id,
        lat: [parseFloat(row.lat)],
        lng: [parseFloat(row.lng)],
        rad: parseFloat(row.rad),

      };
    });
   

   // console.log('mapped data', dataMapped)
   // console.log(data);
    res.json(dataMapped);
  } catch (error) {
    console.error('Error fetching geofences for truck id', truckId, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});





app.listen(port, ()=>{
    console.log('Server is running on port ', port);
})