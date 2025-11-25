const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();
const path= require('path');
const app = express();
const port = process.env.PORT || 3001;
const mqtt = require('mqtt');
const mimeTypes = require('mime-types');
const WebSocket = require('ws');
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




// ---------------- MQTT Reset ---------------- //


// ---------------- MQTT Status Display ---------------- //

const mqttClient = mqtt.connect("mqtt://ekco-tracking.co.za:1883", {
    username: "dev:ekcoFleets",
    password: "dzRND6ZqiI"
});


mqttClient.on("connect", () => {
    console.log("✅ MQTT backend connected");
    mqttClient.subscribe("ekco/serial/custom/v1/geofenceUpdate", (err) => {
        if (err) {
            console.error("❌ Failed to subscribe:", err);
        } else {
            console.log("✅ Subscribed to geofence topic");
        }
    });

    // Subscribe to geofence alerts topic
    mqttClient.subscribe("ekco/serial/custom/v1/geofenceAlert", (err) => {
        if (err) {
            console.error("❌ Failed to subscribe to geofence alerts:", err);
        } else {
            console.log("✅ Subscribed to geofence alerts topic");
        }
    });

});

// MQTT message handler - broadcast immediately for real-time alerts
/* mqttClient.on("message", async (topic, message) => {
    if (topic.includes("geofenceAlert")) {
        try {
            const alertData = JSON.parse(message.toString());
            console.log("Received geofence alert:", alertData);
            // Fetch full alert details from DB
            const fullAlert = await fetchAlertDetails(alertData);
            if (fullAlert) {
                broadcastGeofenceAlerts([fullAlert]);
            }
        } catch (error) {
            console.error("Error processing geofence alert:", error);
        }
    }
});
 */
// Function to send geofence update to all relevant serials
async function sendGeofenceUpdate() {
  try {
    // Get all unique device_serials from geofences table
    const geofenceResult = await pool.query('SELECT DISTINCT unnest(trucks) as device_serial FROM geofences WHERE trucks IS NOT NULL');
    const serials = geofenceResult.rows.map(row => row.device_serial).filter(serial => serial && serial.trim() !== '');

    if (serials.length === 0) {
      return;
    }

    // Send updates to all serials
    const updatePromises = serials.map(serial =>
      new Promise((res, rej) => {
        mqttClient.publish(`ekco/${serial}/custom/v1/geofenceUpdate`, '1', { retain: true }, (error) => {
          if (error) {
            console.error(`Failed to publish geofence update to ${serial}:`, error);
            rej(error);
          } else {
            res();
          }
        });
      })
    );

    // Wait for all updates to complete, allowing partial failures
    const results = await Promise.allSettled(updatePromises);
    const failed = results.filter(result => result.status === 'rejected');
    if (failed.length > 0) {
      console.warn(`Some geofence updates failed: ${failed.length} out of ${serials.length}`);
    }
  } catch (error) {
    console.error('Error in sendGeofenceUpdate:', error);
    throw error;
  }
}





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

  const serial = req.headers.serial;
  const truckId = serial ? parseInt(serial, 10) : null;
  if (!truckId) return res.status(400).json({ error: 'Missing or invalid truck id in header `serial`' });
  try {
    const result = await pool.query(
      'SELECT id, lat, lng, radius_km as rad FROM geofences WHERE $1 = ANY(trucks) AND active = true ORDER BY id',
      [truckId]
    );

    const data = result.rows; 

    let dataMapped = data.map(row => ({
      id: row.id,
      lat: parseFloat(row.lat),
      lng: parseFloat(row.lng),
      rad: parseFloat(row.rad)
    }));
   

   // console.log('mapped data', dataMapped)
   // console.log(data);
    res.json(dataMapped);
  } catch (error) {
    console.error('Error fetching geofences for truck id', truckId, error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


app.post('/api/geofences', async (req, res) => {
  const { name, lat, lng, radius, active, trucks } = req.body;
  const radiusKm = radius / 1000;
  const centrePoint = `POINT(${lng} ${lat})`;

  try {
    const result = await pool.query(
      'INSERT INTO geofences (name, lat, lng, radius_km, active, trucks, color, centre_point) VALUES ($1, $2, $3, $4, $5, $6, $7, ST_GeogFromText($8)) RETURNING id, name, lat, lng, radius_km * 1000 as radius, active, trucks, color',
      [name, lat, lng, radiusKm, active, trucks, generateRandomColor(), centrePoint]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Failed to create geofence' });
    }

    const geofence = result.rows[0];
    const processedTrucks = Array.isArray(geofence.trucks) ? geofence.trucks.map(n => Number(n)).filter(v => !Number.isNaN(v)) : [];
    
    // Wait for both database write and MQTT update
 
    
    res.status(201).json({ ...geofence, trucks: processedTrucks });
       await sendGeofenceUpdate();
  } catch (error) {
    console.error('Error creating geofence:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});



app.put('/api/geofences/:id', async (req, res) => {
  const { id } = req.params;
  const { name, lat, lng, radius, active, trucks, color } = req.body;
  const radiusKm = radius / 1000;
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
    
    // Wait for both database update and MQTT update

    
    res.json({ ...geofence, trucks: processedTrucks });
        await sendGeofenceUpdate();
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

    const deletedGeofence = result.rows[0];
    const processedTrucks = Array.isArray(deletedGeofence.trucks) ? deletedGeofence.trucks.map(n => Number(n)).filter(v => !Number.isNaN(v)) : [];
    
    // Wait for both database delete and MQTT update

    
    res.json({ message: 'Geofence deleted successfully' });
        await sendGeofenceUpdate();
  } catch (error) {
    console.error('Error deleting geofence:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});



app.get('/api/geofence-alerts', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        ga.time,
        ga.geofence_id,
        ga.device_serial,
        ga.alert,
        g.name as geofence_name,
        COALESCE(vi.fleet_number, vi.vehicle_reg, 'Unknown Fleet') as fleet_name
      FROM geofence_alert_ts ga
      LEFT JOIN geofences g ON ga.geofence_id::bigint = g.id::bigint
      LEFT JOIN vehicle_info vi ON ga.device_serial::text = vi.device_serial

      ORDER BY ga.time DESC
      LIMIT 100
    `);

    const alerts = result.rows.map(row => ({
      id: `${row.geofence_id}-${row.device_serial}-${row.time}`,
      type: row.alert === 'OUTSIDE GEOFENCE'? 'Exit' : 'Entry', 
      fleetName: row.fleet_name,
      geofenceName: row.geofence_name,
      alertName: row.alert,
      deviceSerial: row.device_serial,
      alertTime: new Date(row.time * 1000).toISOString().slice(0, 19).replace('T', ' ')
    }));

    res.json(alerts);
  } catch (error) {
    console.error('Error fetching geofence alerts:', error);
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

// Test route to trigger WebSocket broadcast for logging verification
app.get('/test-broadcast', (req, res) => {
  const testAlerts = [
    {
      id: 'test-1',
      type: 'Entry',
      fleetName: 'Test Fleet',
      geofenceName: 'Test Geofence',
      alertName: 'INSIDE GEOFENCE',
      deviceSerial: '12345',
      alertTime: new Date().toISOString().slice(0, 19).replace('T', ' ')
    }
  ];
  broadcastGeofenceAlerts(testAlerts);
  res.send('Test broadcast sent. Check server logs for WebSocket message.');
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
const server = app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// WebSocket server
const wss = new WebSocket.Server({ server });

wss.on('connection', (ws) => {
  console.log('New WebSocket connection');

  ws.on('message', (message) => {
    console.log('Received:', message);
  });

  ws.on('close', () => {
    console.log('WebSocket connection closed');
  });
});

// Function to parse EWKB POINT hex string to lat/lng
function parseEWKBPoint(hex) {
  const bytes = new Uint8Array(hex.match(/.{1,2}/g).map(b => parseInt(b, 16)));
  const view = new DataView(bytes.buffer);
  let offset = 0;
  const byteOrder = view.getUint8(offset); offset += 1;
  const wkbType = view.getUint32(offset, byteOrder === 1); offset += 4;
  if ((wkbType & 0x1FFFFFFF) === 1) { // POINT
    if (wkbType & 0x20000000) { // has SRID
      offset += 4; // skip SRID
    }
    const lng = view.getFloat64(offset, byteOrder === 1); offset += 8;
    const lat = view.getFloat64(offset, byteOrder === 1);
    return { lat, lng };
  }
  throw new Error('Not a POINT geometry');
}

// Function to fetch live truck data
async function fetchLiveTrucks() {
  try {
    const response = await fetch('https://fleetsgpsapi.onrender.com/api/data/latest');
    if (!response.ok) throw new Error('Failed to fetch live data');
    const data = await response.json();
    const parsedTrucks = data.map((item) => {
      const { lat, lng } = parseEWKBPoint(item.location);
      return {
        device_serial: item.device_serial,
        lat,
        lng,
        speed: item.speed,
        time: item.time
      };
    });
    return parsedTrucks;
  } catch (error) {
    console.error('Error fetching live trucks:', error);
    return [];
  }
}

// Function to broadcast live trucks to all WebSocket clients
function broadcastLiveTrucks(trucks) {
  const message = JSON.stringify({
    type: 'live-trucks',
    data: trucks
  });
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Function to fetch alert details for a single alert
async function fetchAlertDetails(alertData) {
  try {
    const result = await pool.query(`
      SELECT
        ga.time,
        ga.geofence_id,
        ga.device_serial,
        ga.alert,
        g.name as geofence_name,
        COALESCE(vi.fleet_number, vi.vehicle_reg, 'Unknown Fleet') as fleet_name
      FROM geofence_alert_ts ga
      LEFT JOIN geofences g ON ga.geofence_id::bigint = g.id::bigint
      LEFT JOIN vehicle_info vi ON ga.device_serial::text = vi.device_serial
      WHERE ga.geofence_id = $1 AND ga.device_serial = $2 AND ga.time = $3 AND ga.alert = $4
      LIMIT 1
    `, [alertData.geofence_id, alertData.device_serial, alertData.time, alertData.alert]);

    if (result.rows.length > 0) {
      const row = result.rows[0];
      return {
        id: `${row.geofence_id}-${row.device_serial}-${row.time}`,
        type: row.alert === 'OUTSIDE GEOFENCE' ? 'Exit' : 'Entry',
        fleetName: row.fleet_name,
        geofenceName: row.geofence_name,
        alertName: row.alert,
        deviceSerial: row.device_serial,
        alertTime: new Date(row.time * 1000).toISOString().slice(0, 19).replace('T', ' ')
      };
    }
    return null;
  } catch (error) {
    console.error('Error fetching alert details:', error);
    return null;
  }
}



// Function to fetch only the latest alert from the database
async function fetchLatestAlert() {
  try {
    const result = await pool.query(`
      SELECT
        ga.time,
        ga.geofence_id,
        ga.device_serial,
        ga.alert,
        g.name as geofence_name,
        COALESCE(vi.fleet_number, vi.vehicle_reg, 'Unknown Fleet') as fleet_name
      FROM geofence_alert_ts ga
      LEFT JOIN geofences g ON ga.geofence_id::bigint = g.id::bigint
      LEFT JOIN vehicle_info vi ON ga.device_serial::text = vi.device_serial
      ORDER BY ga.time DESC
      LIMIT 1
    `);

    if (result.rows.length > 0) {
      const row = result.rows[0];
      return {
        id: `${row.geofence_id}-${row.device_serial}-${row.time}`,
        type: row.alert === 'OUTSIDE GEOFENCE' ? 'Exit' : 'Entry',
        fleetName: row.fleet_name,
        geofenceName: row.geofence_name,
        alertName: row.alert,
        deviceSerial: row.device_serial,
        alertTime: new Date(row.time * 1000).toISOString().slice(0, 19).replace('T', ' ')
      };
    }
    return null;
  } catch (error) {
    console.error('Error fetching latest alert:', error);
    return null;
  }
}

// Store the ID of the last sent alert
let lastSentAlertId = null;

// SINGLE SOURCE: Broadcast alerts only through database polling
function broadcastSingleAlert(alert) {
  const alertId = alert.id;
  
  // Check if we recently sent this alert
  if (alertId === lastSentAlertId) {
    console.log('🟡 Duplicate alert detected, skipping:', alertId);
    return;
  }
  
  console.log('📡 Broadcasting new alert via database polling:', alert);
  
  // Send as single alert
  const message = JSON.stringify({ 
    type: 'new-alert', 
    data: alert 
  });
  
  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
  
  // Update last sent ID
  lastSentAlertId = alertId;
}

// Function to check for and broadcast the latest new alert
async function checkAndBroadcastLatestAlert() {
  try {
    const latestAlert = await fetchLatestAlert();
    
    if (latestAlert && latestAlert.id !== lastSentAlertId) {
      console.log('🟢 Database poll found new alert:', latestAlert.id);
      broadcastSingleAlert(latestAlert);
    } else if (latestAlert) {
      console.log('🟡 Database poll - no new alerts (latest:', latestAlert.id, ')');
    } else {
      console.log('🟡 Database poll - no alerts found');
    }
  } catch (error) {
    console.error('Error in database alert check:', error);
  }
}

// Check for new alerts every 3 seconds (reduced frequency)
setInterval(checkAndBroadcastLatestAlert, 3000);

// Function to fetch and broadcast live trucks
async function fetchAndBroadcastLiveTrucks() {
  try {
    const trucks = await fetchLiveTrucks();
    if (trucks.length > 0) {
      broadcastLiveTrucks(trucks);
    }
  } catch (error) {
    console.error('Error in fetchAndBroadcastLiveTrucks:', error);
  }
}

// Broadcast live trucks every 3 seconds
setInterval(fetchAndBroadcastLiveTrucks, 1000);

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down gracefully...');
  pool.end(() => {
    console.log('Database connection closed.');
    process.exit(0);
  });
});
