const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
});

async function deleteGeofences() {
  try {
    console.log('Connecting to database...');
    await pool.connect();
    
    // First, let's see what geofences exist
    const existing = await pool.query('SELECT id, name FROM geofences ORDER BY id');
    console.log('Current geofences:');
    existing.rows.forEach(row => console.log(`ID: ${row.id}, Name: ${row.name}`));
    
    // Delete all geofences except 'nowhere fence' and ID 51
    const result = await pool.query(
      "DELETE FROM geofences WHERE name != 'nowhere fence' AND id != 51"
    );
    
    console.log(`Deleted ${result.rowCount} geofences`);
    
    // Verify remaining geofences
    const remaining = await pool.query('SELECT id, name FROM geofences ORDER BY id');
    console.log('Remaining geofences:');
    remaining.rows.forEach(row => console.log(`ID: ${row.id}, Name: ${row.name}`));
    
  } catch (error) {
    console.error('Error:', error);
  } finally {
    await pool.end();
  }
}

deleteGeofences();