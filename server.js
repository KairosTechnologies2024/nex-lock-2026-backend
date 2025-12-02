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
const authController = require('./controllers/auth/nex super users/nex_auth_supers_controller');
const authRoutes= require('./routes/nex_auth_routes');
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
mqttClient.on("message", async (topic, message) => {
    if (topic.includes("geofenceAlert")) {
        try {
            const alertData = JSON.parse(message.toString());
            console.log("📡 MQTT Received geofence alert:", alertData);
            // Fetch full alert details from DB
            const fullAlert = await fetchAlertDetails(alertData);
            if (fullAlert) {
                console.log("📡 Broadcasting real-time geofence alert:", fullAlert);
                broadcastSingleAlert(fullAlert);
            }
        } catch (error) {
            console.error("❌ Error processing MQTT geofence alert:", error);
        }
    }
});

// Function to send geofence update to all relevant serials
async function sendGeofenceUpdate(serials = null) {
  try {
  
    if (!serials) {
      const geofenceResult = await pool.query('SELECT DISTINCT unnest(trucks) as device_serial FROM geofences WHERE trucks IS NOT NULL');
      serials = geofenceResult.rows.map(row => row.device_serial).filter(serial => serial && serial.trim() !== '');
    }

    if (serials.length === 0) {
      return;
    }

  
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
    
  
    await sendGeofenceUpdate(processedTrucks);
    
    res.status(201).json({ ...geofence, trucks: processedTrucks });
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
    // Get the old trucks before update
    const oldGeofence = await pool.query('SELECT trucks FROM geofences WHERE id = $1', [id]);
    const oldTrucks = oldGeofence.rows[0]?.trucks || [];

    const result = await pool.query(
      'UPDATE geofences SET name = $1, lat = $2, lng = $3, radius_km = $4, active = $5, trucks = $6, color = $7, centre_point = ST_GeogFromText($8) WHERE id = $9 RETURNING id, name, lat, lng, radius_km * 1000 as radius, active, trucks, color',
      [name, lat, lng, radiusKm, active, trucks, color, centrePoint, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Geofence not found' });
    }

    const geofence = result.rows[0];
    const processedTrucks = Array.isArray(geofence.trucks) ? geofence.trucks.map(n => Number(n)).filter(v => !Number.isNaN(v)) : [];
    
   
    const allAffectedTrucks = [...new Set([...oldTrucks, ...processedTrucks])];
    await sendGeofenceUpdate(allAffectedTrucks);
    
    res.json({ ...geofence, trucks: processedTrucks });
  } catch (error) {
    console.error('Error updating geofence:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


app.delete('/api/geofences/:id', async (req, res) => {
  const { id } = req.params;

  try {
    // Get the trucks before deletion
    const geofence = await pool.query('SELECT trucks FROM geofences WHERE id = $1', [id]);
    const trucks = geofence.rows[0]?.trucks || [];

    const result = await pool.query('DELETE FROM geofences WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Geofence not found' });
    }

    const processedTrucks = Array.isArray(trucks) ? trucks.map(n => Number(n)).filter(v => !Number.isNaN(v)) : [];
    await sendGeofenceUpdate(processedTrucks);

    res.json({ message: 'Geofence deleted successfully' });
  } catch (error) {
    console.error('Error deleting geofence:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});


app.post('/api/geofences/bulk', async (req, res) => {
  const geofences = req.body;

  if (!Array.isArray(geofences) || geofences.length === 0) {
    return res.status(400).json({ error: 'Geofences array is required' });
  }

  const created = [];
  const errors = [];

  try {
    for (const geofence of geofences) {
      try {
        const { name, lat, lng, radius, active, trucks } = geofence;

        if (!name || typeof lat !== 'number' || typeof lng !== 'number' || typeof radius !== 'number') {
          errors.push({ name: name || 'Unknown', error: 'Invalid geofence data' });
          continue;
        }

        const radiusKm = radius / 1000;
        const centrePoint = `POINT(${lng} ${lat})`;

        const result = await pool.query(
          'INSERT INTO geofences (name, lat, lng, radius_km, active, trucks, color, centre_point) VALUES ($1, $2, $3, $4, $5, $6, $7, ST_GeogFromText($8)) RETURNING id, name, lat, lng, radius_km * 1000 as radius, active, trucks, color',
          [name, lat, lng, radiusKm, active !== false, trucks || [], generateRandomColor(), centrePoint]
        );

        if (result.rows.length > 0) {
          const createdGeofence = result.rows[0];
          const processedTrucks = Array.isArray(createdGeofence.trucks) ? createdGeofence.trucks.map(n => Number(n)).filter(v => !Number.isNaN(v)) : [];
          created.push({ ...createdGeofence, trucks: processedTrucks });
        } else {
          errors.push({ name, error: 'Failed to create geofence' });
        }
      } catch (geofenceError) {
        console.error('Error creating geofence:', geofence.name, geofenceError);
        errors.push({ name: geofence.name || 'Unknown', error: geofenceError.message });
      }
    }

    // Send MQTT update after all geofences are created
    if (created.length > 0) {
      await sendGeofenceUpdate();
    }

    res.status(201).json({
      message: `Successfully created ${created.length} geofences${errors.length > 0 ? ` with ${errors.length} errors` : ''}`,
      created,
      errors
    });
  } catch (error) {
    console.error('Error in bulk geofence creation:', error);
    res.status(500).json({ error: 'Internal server error during bulk creation' });
  }
});

app.post('/api/geofences/bulk', async (req, res) => {
  const geofences = req.body;

  if (!Array.isArray(geofences) || geofences.length === 0) {
    return res.status(400).json({ error: 'Invalid geofences data' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const createdGeofences = [];
    const errors = [];

    for (const geofence of geofences) {
      try {
        const { name, lat, lng, radius, active, trucks } = geofence;
        const radiusKm = radius / 1000;
        const centrePoint = `POINT(${lng} ${lat})`;

        const result = await client.query(
          'INSERT INTO geofences (name, lat, lng, radius_km, active, trucks, color, centre_point) VALUES ($1, $2, $3, $4, $5, $6, $7, ST_GeogFromText($8)) RETURNING id, name, lat, lng, radius_km * 1000 as radius, active, trucks, color',
          [name, lat, lng, radiusKm, active, trucks, generateRandomColor(), centrePoint]
        );

        if (result.rows.length > 0) {
          const createdGeofence = result.rows[0];
          const processedTrucks = Array.isArray(createdGeofence.trucks) ? createdGeofence.trucks.map(n => Number(n)).filter(v => !Number.isNaN(v)) : [];
          createdGeofences.push({ ...createdGeofence, trucks: processedTrucks });
        }
      } catch (error) {
        console.error('Error creating geofence:', geofence.name, error);
        errors.push(`Failed to create geofence for ${geofence.name}: ${error.message}`);
      }
    }

    await client.query('COMMIT');

    // Send MQTT update after all geofences are created
    await sendGeofenceUpdate();

    res.status(201).json({
      created: createdGeofences,
      errors: errors
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error in bulk geofence creation:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
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


app.get('/api/alerts/latest200', async (req, res)=>{


 try {
        const result = await pool.query(`
            SELECT * 
            FROM alert_ts 
            ORDER BY time DESC 
            LIMIT 200
        `);
        console.log('latest 200 ', result.rows)
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Database error", details: err.message });
    }


});
app.get('/api/alerts/latest', async (req, res)=>{


 try {
        const result = await pool.query(`
            SELECT DISTINCT ON (device_serial) *
            FROM alert_ts
            ORDER BY device_serial, time DESC
        `);
        console.log(result.rows)
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Database error", details: err.message });
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

// Auth routes (including customers)
app.use('/api', authRoutes);

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

function broadcast(data) {
    const message = JSON.stringify(data);
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        } else {
            console.log("Client not open:", client.readyState);
        }
    });
}





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







// ---------------- Alerts Broadcast ---------------- //

// let latestAlertTimestamp = 0;
// let latestAlertTimestamp;
latestAlertTimestamp = Math.floor(Date.now() / 1000) - 60;

(async () => {
    const res = await pool.query('SELECT MAX(time)::bigint AS latest FROM alert_ts');
    const maxDBTime = parseInt(res.rows[0].latest) || 0;
    const now = Math.floor(Date.now() / 1000);
    const sixtySecondsAgo = now - 60;

    if (maxDBTime > now) {
        console.warn("⚠️ maxDBTime is in the future! Resetting to now:", now);
        latestAlertTimestamp = now;
    } else if (maxDBTime < sixtySecondsAgo) {
        console.log("✅ Using maxDBTime from DB:", maxDBTime);
        latestAlertTimestamp = maxDBTime;
    } else {
        console.log("🕒 DB time is recent or missing. Using now - 60s:", sixtySecondsAgo);
        latestAlertTimestamp = sixtySecondsAgo;
    }

    console.log("🔧 Initial latestAlertTimestamp set to:", latestAlertTimestamp);

    setInterval(broadcastAlerts, 3000);
})();


async function broadcastAlerts() {
    try {
        const now = Math.floor(Date.now() / 1000);
        // console.log("🕵️‍♂️ Checking for alerts after:", latestAlertTimestamp);

        const result = await pool.query(
            `
            SELECT time::bigint AS time, device_serial, alert 
            FROM alert_ts 
            WHERE time::bigint > $1 
            ORDER BY time DESC
            `,
            [latestAlertTimestamp]
        );

        // console.log("🔍 Raw new alerts:", result.rows.map(r => ({
        //     time: r.time,
        //     alert: r.alert
        // })));

        if (result.rows.length === 0) {
            // console.log("📭 No new alerts found.");
            return;
        }

        // Discard alerts in the future
        const validAlerts = result.rows.filter(r => {
            const t = parseInt(r.time);
            if (t > now) {
                // console.warn(`⚠️ Skipping future alert time=${t} (now=${now}, skew=${t - now}s)`);
                return false;
            }
            return true;
        });

        if (validAlerts.length === 0) {
            // console.log("🚫 All alerts are in the future. Skipping broadcast.");
            return;
        }

        // Optional: Log how many were skipped
        const skippedCount = result.rows.length - validAlerts.length;
        if (skippedCount > 0) {
            // console.log(`🧹 Skipped ${skippedCount} future-dated alerts.`);
        }

        // Filter unimportant alerts
        const filteredAlerts = validAlerts.filter(r =>
            r.alert !== "Door opened" && r.alert !== "Ignition on"
        );

        if (filteredAlerts.length > 0) {
            const alertTimes = filteredAlerts.map(r => parseInt(r.time));
            const maxTime = Math.max(...alertTimes);

            // console.log("📤 Filtered new alerts to broadcast:", filteredAlerts.map(r => ({
            //     time: r.time,
            //     alert: r.alert
            // })));

            latestAlertTimestamp = maxTime + 1;

            broadcast({
                type: "alert_update",
                data: filteredAlerts,
            });
        } else {
            // All valid, but filtered out as unimportant
            const allTimes = validAlerts.map(r => parseInt(r.time));
            latestAlertTimestamp = Math.max(...allTimes) + 1;
            // console.log("⚠️ All alerts filtered out. Timestamp updated anyway.");
        }

    } catch (err) {
        console.error("❌ Error broadcasting alerts:", err.message);
    }
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

// Store the timestamp of the last sent geofence alert
let latestGeofenceAlertTimestamp = Math.floor(Date.now() / 1000) - 60;

// Function to broadcast a single geofence alert
function broadcastSingleAlert(alert) {
  console.log('📡 Broadcasting geofence alert:', alert);

  const message = JSON.stringify({
    type: 'new-alert',
    data: alert
  });

  wss.clients.forEach(client => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });
}

// Function to check for and broadcast new geofence alerts
async function checkAndBroadcastNewGeofenceAlerts() {
  try {
    const now = Math.floor(Date.now() / 1000);
    console.log("🔍 Checking for new geofence alerts after:", latestGeofenceAlertTimestamp);

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
      WHERE ga.time > $1
      ORDER BY ga.time DESC
    `, [latestGeofenceAlertTimestamp]);

    if (result.rows.length === 0) {
      console.log("📭 No new geofence alerts found.");
      return;
    }

    // Discard alerts in the future
    const validAlerts = result.rows.filter(r => {
      const t = parseInt(r.time);
      if (t > now) {
        console.warn(`⚠️ Skipping future geofence alert time=${t} (now=${now}, skew=${t - now}s)`);
        return false;
      }
      return true;
    });

    if (validAlerts.length === 0) {
      console.log("🚫 All geofence alerts are in the future. Skipping broadcast.");
      return;
    }

    // Process and broadcast new alerts
    const newAlerts = validAlerts.map(row => ({
      id: `${row.geofence_id}-${row.device_serial}-${row.time}`,
      type: row.alert === 'OUTSIDE GEOFENCE' ? 'Exit' : 'Entry',
      fleetName: row.fleet_name,
      geofenceName: row.geofence_name,
      alertName: row.alert,
      deviceSerial: row.device_serial,
      alertTime: new Date(row.time * 1000).toISOString().slice(0, 19).replace('T', ' ')
    }));

    // Update timestamp to the latest alert time + 1
    const maxTime = Math.max(...validAlerts.map(r => parseInt(r.time)));
    latestGeofenceAlertTimestamp = maxTime + 1;

    console.log("📤 Broadcasting new geofence alerts:", newAlerts.length);

    // Broadcast each new alert
    newAlerts.forEach(alert => {
      broadcastSingleAlert(alert);
    });

  } catch (error) {
    console.error("❌ Error checking for new geofence alerts:", error);
  }
}

// Check for new geofence alerts every 2 seconds (more frequent than regular alerts)
setInterval(checkAndBroadcastNewGeofenceAlerts, 2000);

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
