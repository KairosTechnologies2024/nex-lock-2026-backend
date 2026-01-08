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
const deviceHealthRoutes = require('./routes/deviceHealthRoutes');

// Declare WebSocket server at module level
let wss;

// Middleware
app.use(cors());
app.use(express.json({ limit: '900mb' }));

// Database connection
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,

  // Connection limits
  max: 20,                    // Maximum connections in pool
  min: 2,                     // Minimum connections to maintain

  // Idle connection management (CRITICAL for preventing locks)
  idleTimeoutMillis: 30000,   // Close idle connections after 30 seconds
  connectionTimeoutMillis: 2000, // Timeout acquiring connection from pool

  // Query timeouts (prevents long-running queries that cause locks)
  query_timeout: 30000,       // 30 second query timeout
  statement_timeout: 30000,   // 30 second statement timeout

  // Connection validation
  allowExitOnIdle: true,      // Allow pool to close when idle

  // Retry and cleanup
  keepAlive: true,            // Keep connections alive
  keepAliveInitialDelayMillis: 0,

  // SSL disabled for Netcup PostgreSQL
  ssl: false
});

// Shared in-memory objects for vehicle lock functionality
const lockStatusMap = {};











pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

// Monitor pool health every 30 seconds
setInterval(() => {
  console.log('🔍 Pool stats:', {
    totalCount: pool.totalCount,
    idleCount: pool.idleCount,
    waitingCount: pool.waitingCount
  });
}, 30000);

async function ensureGeofencePolygonColumns() {
  try {
    await pool.query("ALTER TABLE geofences ADD COLUMN IF NOT EXISTS shape TEXT DEFAULT 'circle'");
    await pool.query("ALTER TABLE geofences ADD COLUMN IF NOT EXISTS polygon_coords JSONB");
    console.log('Ensured geofences table has shape and polygon_coords columns');
  } catch (err) {
    console.error('Failed to ensure polygon columns on geofences table', err);
  }
}

async function ensureGeofenceReferencesTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS switch_geofences_references (
        id SERIAL PRIMARY KEY,
        incoming_name VARCHAR(255) NOT NULL,
        outgoing_name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Remove UNIQUE constraint if it exists (for existing tables)
    try {
      await pool.query(`
        ALTER TABLE switch_geofences_references 
        DROP CONSTRAINT IF EXISTS switch_geofences_references_incoming_name_key
      `);
      await pool.query(`
        ALTER TABLE switch_geofences_references 
        DROP CONSTRAINT IF EXISTS switch_geofences_references_incoming_name_unique
      `);
    } catch (constraintErr) {
      // Constraint might not exist, which is fine
      console.log('Note: No existing UNIQUE constraint to remove (or already removed)');
    }

    // Create trigger for updating updated_at
    await pool.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql'
    `);

    await pool.query(`
      DROP TRIGGER IF EXISTS update_geofence_references_updated_at ON switch_geofences_references;
      CREATE TRIGGER update_geofence_references_updated_at
        BEFORE UPDATE ON switch_geofences_references
        FOR EACH ROW
        EXECUTE FUNCTION update_updated_at_column()
    `);

    console.log('Ensured geofence references table exists');
  } catch (err) {
    console.error('Failed to ensure geofence references table', err);
  }
}

async function ensureGeofenceReferencesV2Table() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS geofence_references (
        id SERIAL PRIMARY KEY,
        geofence_id INTEGER REFERENCES geofences(id) ON DELETE CASCADE,
        incoming_names TEXT[],
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create index for better performance on array operations
    await pool.query(`
      CREATE INDEX IF NOT EXISTS idx_geofence_references_incoming_names
      ON geofence_references USING GIN (incoming_names)
    `);

    // Create trigger for updating updated_at
    await pool.query(`
      CREATE OR REPLACE FUNCTION update_geofence_references_updated_at()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = CURRENT_TIMESTAMP;
        RETURN NEW;
      END;
      $$ language 'plpgsql'
    `);

    await pool.query(`
      DROP TRIGGER IF EXISTS trigger_geofence_references_updated_at ON geofence_references;
      CREATE TRIGGER trigger_geofence_references_updated_at
        BEFORE UPDATE ON geofence_references
        FOR EACH ROW
        EXECUTE FUNCTION update_geofence_references_updated_at()
    `);

    console.log('Ensured geofence references v2 table exists');
  } catch (err) {
    console.error('Failed to ensure geofence references v2 table', err);
  }
}

async function initializeDatabase() {
  try {
    await ensureGeofencePolygonColumns();
    await ensureGeofenceReferencesTable();
    await ensureGeofenceReferencesV2Table();
    console.log('✅ Database initialization completed');
  } catch (error) {
    console.error('❌ Database initialization failed:', error);
    process.exit(1);
  }
}

// Initialize database and start server
async function startServer() {
  try {
    await initializeDatabase();

    // Start server only after database initialization
    const server = app.listen(port, () => {
      console.log(`Server running on port ${port}`);
    });

    // Initialize WebSocket server (assigned to module-level variable)
    wss = new WebSocket.Server({ server });

    wss.on('connection', (ws) => {
      console.log('New WebSocket connection');

      ws.on('message', (message) => {
        console.log('Received:', message);
      });

      ws.on('close', () => {
        console.log('WebSocket connection closed');
      });
    });

// Declare WebSocket server at module level

function broadcast(data) {
  if (!wss) {
    console.warn('WebSocket server not initialized yet');
    return;
  }
  const message = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    } else {
      console.log("Client not open:", client.readyState);
    }
  });
}

  } catch (error) {
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
}

startServer();




// Helper function to calculate polygon centroid
const calculatePolygonCentroid = (polygon) => {
  if (!polygon || polygon.length === 0) return { lat: 0, lng: 0 };

  const totalLat = polygon.reduce((sum, point) => sum + point.lat, 0);
  const totalLng = polygon.reduce((sum, point) => sum + point.lng, 0);

  return {
    lat: totalLat / polygon.length,
    lng: totalLng / polygon.length
  };
};

// ---------------- MQTT Reset ---------------- //


// ---------------- MQTT Status Display ---------------- //

const mqttClient = mqtt.connect("mqtt://ekco-tracking.co.za:1883", {
    username: "dev:ekcoFleets",
    password: "dzRND6ZqiI"
});

// ---------------- MQTT lock ---------------- //
const lockVehicle = async (req, res) => {
    const { serial_number, status } = req.body;
    if (!serial_number || typeof status !== "number") {
        return res.status(400).json({ error: "Missing or invalid parameters." });
    }
    const topic = `ekco/v1/${serial_number}/lock/control`;
    const secondTopic = `ekco/${serial_number}/custom/v1/lockControl`;
    const payload = `${status}`;
    const mqttOptions = {
        username: process.env.MQTT_USERNAME || "dev:ekcoFleets",
        password: process.env.MQTT_PASSWORD || "dzRND6ZqiI",
        reconnectPeriod: 0
    };
    const client = mqtt.connect("mqtt://ekco-tracking.co.za:1883", mqttOptions);
    let responded = false;
    let publishCount = 0;
    let errors = [];
    client.on("connect", () => {
        const handlePublish = (err, topicName) => {
            publishCount++;
            if (err) {
                errors.push({ topic: topicName, error: err.message });
            }
            if (publishCount === 2) {
                if (!responded) {
                    responded = true;
                    if (errors.length > 0) {
                        console.error("MQTT publish errors:", errors);
                        res.status(500).json({ error: "Failed to publish to MQTT topics", details: errors });
                    } else {
                        lockStatusMap[serial_number] = status;
                        pool.query(
                            'INSERT INTO vehicle_lock_status (serial_number, status) VALUES ($1, $2) ON CONFLICT (serial_number) DO UPDATE SET status = EXCLUDED.status',
                            [serial_number, status]
                        ).catch(dbErr => {
                            console.error('Failed to persist lock status from API:', dbErr);
                        });
                        res.json({ message: "Command sent successfully", topics: [topic, secondTopic], payload });
                    }
                    client.end();
                }
            }
        };
        client.publish(topic, payload, { retain: false }, (err) => handlePublish(err, topic));
        client.publish(secondTopic, payload, { retain: false }, (err) => handlePublish(err, secondTopic));
    });
    client.on("error", (err) => {
        if (!responded) {
            responded = true;
            console.error("MQTT connection error:", err);
            res.status(500).json({ error: "MQTT connection failed", details: err.message });
        }
        client.end();
    });
};

const getLockStatus = async (req, res) => {
    const { serial_number } = req.params;
    try {
        const result = await pool.query(
            'SELECT status FROM vehicle_lock_status WHERE serial_number = $1',
            [serial_number]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: "No status found for this vehicle." });
        }
        res.json({ status: result.rows[0].status });
    } catch (err) {
        res.status(500).json({ error: "Database error", details: err.message });
    }
};

const deviceReset = async (req, res) => {
    const { serial_number, status } = req.body;
    if (!serial_number || typeof status !== "number") {
        return res.status(400).json({ error: "Missing or invalid parameters." });
    }
    const topic = `ekco/v1/${serial_number}/device/reset`;
    const secondTopic = `ekco/${serial_number}/custom/v1/deviceReset`;
    const payload = `${status}`;
    const mqttOptions = {
        username: "dev:ekcoFleets",
        password: "dzRND6ZqiI",
        reconnectPeriod: 0
    };
    const client = mqtt.connect("mqtt://ekco-tracking.co.za:1883", mqttOptions);
    let responded = false;
    let publishCount = 0;
    let errors = [];
    client.on("connect", () => {
        const handlePublish = (err, topicName) => {
            publishCount++;
            if (err) {
                errors.push({ topic: topicName, error: err.message });
            }
            if (publishCount === 2) {
                if (!responded) {
                    responded = true;
                    if (errors.length > 0) {
                        console.error("MQTT publish errors:", errors);
                        res.status(500).json({ error: "Failed to publish to MQTT topics", details: errors });
                    } else {
                        res.json({ message: "Command sent successfully", topics: [topic, secondTopic], payload });
                    }
                    client.end();
                }
            }
        };
        client.publish(topic, payload, { retain: false }, (err) => handlePublish(err, topic));
        client.publish(secondTopic, payload, { retain: false }, (err) => handlePublish(err, secondTopic));
    });
    client.on("error", (err) => {
        if (!responded) {
            responded = true;
            console.error("MQTT connection error:", err);
            res.status(500).json({ error: "MQTT connection failed", details: err.message });
        }
        client.end();
    });
};


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

    // Subscribe to logs topic
    mqttClient.subscribe("ekco/v1/+/logs/data", (err) => {
        if (err) {
            console.error("❌ Failed to subscribe to logs/data:", err);
        } else {
            console.log("✅ Subscribed to all vehicle logs/data topics");
        }
    });

});

// MQTT message handler - broadcast immediately for real-time alerts and logs
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
    } else if (topic.includes("logs/data")) {
        const payload = message.toString();
        console.log(`[MQTT LOGS] Received on topic: ${topic} | payload: ${payload}`);

        const matchLogs = topic.match(/^ekco\/v1\/(.+)\/logs\/data$/);
        if (matchLogs) {
            const serial = matchLogs[1];
            console.log(`[MQTT LOGS] Matched serial: ${serial}`);

            if (!logsMap[serial]) logsMap[serial] = [];
            const logEntry = {
                timestamp: Date.now(),
                data: payload
            };
            logsMap[serial].push(logEntry);
            // Optionally limit log size per device
            if (logsMap[serial].length > 1000) logsMap[serial].shift();

            // Stream to active SSE clients for logs
            console.log(`[MQTT LOGS] Checking activeStreams for serial ${serial}:`, !!activeStreams[serial]);
            if (activeStreams[serial] && activeStreams[serial].logs) {
                console.log(`[MQTT LOGS] Found ${activeStreams[serial].logs.length} active SSE clients for serial ${serial}`);
                activeStreams[serial].logs.forEach((res, index) => {
                    try {
                        const dataToSend = `data: ${JSON.stringify({ topic, payload })}\n\n`;
                        console.log(`[MQTT LOGS] Sending to client ${index}: ${dataToSend.substring(0, 100)}...`);
                        res.write(dataToSend);
                    } catch (writeError) {
                        console.error(`[MQTT LOGS] Error writing to SSE client ${index}:`, writeError);
                    }
                });
            } else {
                console.log(`[MQTT LOGS] No active SSE streams found for serial ${serial}`);
            }
        } else {
            console.log(`[MQTT LOGS] Topic ${topic} did not match expected pattern`);
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


app.get('/api/alerts/lock-stats', async (req, res)=>{
  try {
         const result = await pool.query(`
             SELECT
                 a.time,
                 a.device_serial,
                 a.alert,
                 COALESCE(vi.fleet_number, vi.vehicle_reg, 'Unknown Fleet') as fleet
             FROM alert_ts a
             LEFT JOIN vehicle_info vi ON a.device_serial::text = vi.device_serial
             WHERE a.alert IN ('LOCKED', 'UNLOCKED', 'LOCK JAMMED !', 'LOCK JAM !')
                 AND vi.company_id = 'e5a99ee4-4306-4065-bacd-876004cf1555'
             ORDER BY a.time DESC
         `);
         console.log('lock stats alerts:', result.rows.length)
         res.json(result.rows);
     } catch (err) {
         res.status(500).json({ error: "Database error", details: err.message });
     }
 });


app.get('/api/geofences', async (req, res) => {
  try {
  
  const result = await pool.query('SELECT id, name, lat, lng, radius_km * 1000 as radius, active, trucks, color, shape, polygon_coords FROM geofences ORDER BY id');

    const geofences = result.rows.map(row => {

      let trucks = row.trucks;
      if (!Array.isArray(trucks)) {
        trucks = [];
      } else {
        trucks = trucks.map(n => (typeof n === 'number' ? n : parseInt(n, 10))).filter(v => !Number.isNaN(v));
      }
      return { ...row, trucks, shape: row.shape || 'circle', polygon_coords: row.polygon_coords };
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





app.post('/api/geofences', async (req, res) => {
  const { name, lat, lng, radius, active, trucks, shape, polygonCoords } = req.body;
  const normalizedShape = shape === 'polygon' ? 'polygon' : 'circle';
  const normalizedPolygon = Array.isArray(polygonCoords) ? polygonCoords.map((p) => ({
    lat: parseFloat(p.lat),
    lng: parseFloat(p.lng)
  })).filter(p => !Number.isNaN(p.lat) && !Number.isNaN(p.lng)) : [];

  if (normalizedShape === 'polygon' && normalizedPolygon.length < 3) {
    return res.status(400).json({ error: 'Polygon geofences require at least three coordinates.' });
  }

  const polygonCentroid = normalizedShape === 'polygon' ? calculatePolygonCentroid(normalizedPolygon) : null;
  const baseLat = normalizedShape === 'polygon' ? polygonCentroid.lat : lat;
  const baseLng = normalizedShape === 'polygon' ? polygonCentroid.lng : lng;
  const radiusKm = normalizedShape === 'polygon' ? 0 : radius / 1000;
  const centrePoint = `POINT(${baseLng} ${baseLat})`;

  try {

    const nameCheck = await pool.query('SELECT id FROM geofences WHERE name = $1', [name]);
    if (nameCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Geofence name already exists. Please choose a different name.' });
    }

  
    if (normalizedShape === 'circle') {
      const pointCheck = await pool.query('SELECT id FROM geofences WHERE lat = $1 AND lng = $2', [baseLat, baseLng]);
      if (pointCheck.rows.length > 0) {
        return res.status(400).json({ error: 'Geofence with the same centre point already exists. Please choose a different location.' });
      }

      const overlapCheck = await pool.query(
        'SELECT id FROM geofences WHERE ST_DWithin(centre_point, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, (radius_km + $3) * 1000)',
        [baseLng, baseLat, radiusKm]
      );

      if (overlapCheck.rows.length > 0) {
        return res.status(400).json({ error: 'Geofence would intersect with an existing geofence. Please choose a different location or smaller radius.' });
      }
    }

    const result = await pool.query(
      'INSERT INTO geofences (name, lat, lng, radius_km, active, trucks, color, centre_point, shape, polygon_coords) VALUES ($1, $2, $3, $4, $5, $6, $7, ST_GeogFromText($8), $9, $10) RETURNING id, name, lat, lng, radius_km * 1000 as radius, active, trucks, color, shape, polygon_coords',
      [name, baseLat, baseLng, radiusKm, active, trucks, generateRandomColor(), centrePoint, normalizedShape, normalizedShape === 'polygon' ? JSON.stringify(normalizedPolygon) : null]
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
  const { name, lat, lng, radius, active, trucks, color, shape, polygonCoords } = req.body;
  const normalizedShape = shape === 'polygon' ? 'polygon' : 'circle';
  const normalizedPolygon = Array.isArray(polygonCoords) ? polygonCoords.map((p) => ({
    lat: parseFloat(p.lat),
    lng: parseFloat(p.lng)
  })).filter(p => !Number.isNaN(p.lat) && !Number.isNaN(p.lng)) : [];

  if (normalizedShape === 'polygon' && normalizedPolygon.length < 3) {
    return res.status(400).json({ error: 'Polygon geofences require at least three coordinates.' });
  }

  const polygonCentroid = normalizedShape === 'polygon' ? calculatePolygonCentroid(normalizedPolygon) : null;
  const baseLat = normalizedShape === 'polygon' ? polygonCentroid.lat : lat;
  const baseLng = normalizedShape === 'polygon' ? polygonCentroid.lng : lng;
  const radiusKm = normalizedShape === 'polygon' ? 0 : radius / 1000;
  const centrePoint = `POINT(${baseLng} ${baseLat})`;

  try {
    // Check if the new name already exists (excluding the current geofence)
    const nameCheck = await pool.query('SELECT id FROM geofences WHERE name = $1 AND id != $2', [name, id]);
    if (nameCheck.rows.length > 0) {
      return res.status(400).json({ error: 'Geofence name already exists. Please choose a different name.' });
    }

    // Check if the new geofence would intersect with any existing geofence (excluding the current one)
    if (normalizedShape === 'circle') {
      const overlapCheck = await pool.query(
        'SELECT id FROM geofences WHERE ST_DWithin(centre_point, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, (radius_km + $4) * 1000) AND id != $3',
        [baseLng, baseLat, id, radiusKm]
      );

      if (overlapCheck.rows.length > 0) {
        return res.status(400).json({ error: 'Geofence would intersect with an existing geofence. Please choose a different location or smaller radius.' });
      }
    }

    // Get the old trucks before update
    const oldGeofence = await pool.query('SELECT trucks FROM geofences WHERE id = $1', [id]);
    const oldTrucks = oldGeofence.rows[0]?.trucks || [];

    const result = await pool.query(
      'UPDATE geofences SET name = $1, lat = $2, lng = $3, radius_km = $4, active = $5, trucks = $6, color = $7, centre_point = ST_GeogFromText($8), shape = $9, polygon_coords = $10 WHERE id = $11 RETURNING id, name, lat, lng, radius_km * 1000 as radius, active, trucks, color, shape, polygon_coords',
      [name, baseLat, baseLng, radiusKm, active, trucks, color, centrePoint, normalizedShape, normalizedShape === 'polygon' ? JSON.stringify(normalizedPolygon) : null, id]
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
    return res.status(400).json({ error: 'Invalid geofences data' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Clear all trucks before bulk import (original behavior)
    try {
      await client.query(
        'UPDATE geofences SET trucks = $1 WHERE id != $2',
        [[], 51]
      );
      console.log("Cleared trucks for all geofences except ID 51");
    } catch (err) {
      console.error("Error clearing existing trucks before bulk import:", err);
      throw err;
    }
    const createdGeofences = [];
    const updatedGeofences = [];
    const errors = [];
    const allAffectedTrucks = new Set();

    for (const geofence of geofences) {
      try {
        const { name, lat, lng, radius, active, trucks } = geofence;

        if (!name || typeof lat !== 'number' || typeof lng !== 'number' || typeof radius !== 'number') {
          errors.push(`Invalid geofence data for ${name || 'Unknown'}`);
          continue;
        }

        const radiusKm = radius / 1000;
        const centrePoint = `POINT(${lng} ${lat})`;

        // Normalize incoming trucks to canonical device_serial values (and create missing vehicle_info rows)
        // Normalize incoming trucks to canonical device_serial values.
        // Do NOT create missing vehicle_info rows; if any identifiers are unknown, skip this geofence entry.
        const { normalized: processedNewTrucks, missing: missingIdentifiers } = await normalizeTruckIdentifiers(client, Array.isArray(trucks) ? trucks : []);

        // If there are missing identifiers, skip this geofence and record an error to avoid creating blank/invalid geofences.
        if (missingIdentifiers && missingIdentifiers.length > 0) {
          errors.push(`Geofence "${name}": unknown truck identifiers: ${missingIdentifiers.join(', ')}`);
          continue;
        }

        // FIRST: Check if the incoming geofence center point falls inside any existing polygon geofence
        // Use pool connection (not client) to avoid transaction issues
        console.log(`🔍 Checking if point (${lat}, ${lng}) for "${name}" falls inside any existing polygons...`);
        let containingPolygon = null;
        try {
          const allPolygons = await pool.query(
            'SELECT id, trucks, name, polygon_coords FROM geofences WHERE shape = \'polygon\' AND polygon_coords IS NOT NULL'
          );
          console.log(`📐 Found ${allPolygons.rows.length} existing polygons to check against`);

          for (const polygon of allPolygons.rows) {
            try {
              console.log(`🔸 Checking polygon "${polygon.name}" (ID: ${polygon.id})`);
              const coords = polygon.polygon_coords;
              if (Array.isArray(coords) && coords.length >= 3) {
                console.log(`   Polygon has ${coords.length} coordinates`);
                // Validate and convert coordinates
                const validCoords = coords.filter(p =>
                  p && typeof p.lat === 'number' && typeof p.lng === 'number' &&
                  !isNaN(p.lat) && !isNaN(p.lng) &&
                  p.lat >= -90 && p.lat <= 90 && p.lng >= -180 && p.lng <= 180
                );
                console.log(`   Valid coordinates: ${validCoords.length}/${coords.length}`);

                if (validCoords.length >= 3) {
                  // Convert stored format [{lat, lng}, ...] to [[lng, lat], ...] for PostGIS
                  const polygonCoords = validCoords.map(p => `(${p.lng} ${p.lat})`).join(', ');
                  const polygonWKT = `POLYGON((${polygonCoords}, ${validCoords[0].lng} ${validCoords[0].lat}))`; // Close the polygon
                  console.log(`   Generated WKT: ${polygonWKT.substring(0, 100)}...`);
                  console.log(`   Testing point: POINT(${lng} ${lat})`);

                  const pointCheck = await pool.query(
                    'SELECT ST_Contains(ST_GeomFromText($1, 4326), ST_GeomFromText($2, 4326)) as contains',
                    [polygonWKT, `POINT(${lng} ${lat})`]
                  );

                  console.log(`   Containment result: ${pointCheck.rows[0]?.contains}`);
                  if (pointCheck.rows.length > 0 && pointCheck.rows[0].contains) {
                    console.log(`   ✅ Point is inside polygon "${polygon.name}"!`);
                    containingPolygon = polygon;
                    break;
                  }
                } else {
                  console.log(`   ❌ Not enough valid coordinates (${validCoords.length})`);
                }
              } else {
                console.log(`   ❌ Invalid coordinates array or not enough points`);
              }
            } catch (err) {
              console.warn(`Error checking polygon ${polygon.id}:`, err.message);
              // Continue to next polygon
            }
          }
          console.log(containingPolygon ? `✅ Point falls inside polygon "${containingPolygon.name}"` : `❌ Point (${lat}, ${lng}) for "${name}" does not fall inside any existing polygons`);
        } catch (err) {
          console.warn('Error fetching polygons for containment check:', err.message);
          // Continue without polygon checking if there's an error
        }

        if (containingPolygon) {
          // Found an existing polygon geofence that contains this point — merge trucks into it
          console.log(`🔄 Merging trucks for "${name}" into existing polygon "${containingPolygon.name}"`);
          const polygonParent = containingPolygon;
          const parentTrucks = Array.isArray(polygonParent.trucks) ? polygonParent.trucks.map(String) : [];
          const incomingTrucks = processedNewTrucks.map(String);

          // Merge and deduplicate
          const mergedTrucks = [...new Set([...parentTrucks, ...incomingTrucks])];

          try {
            const updatePolygon = await client.query(
              'UPDATE geofences SET trucks = $1 WHERE id = $2 RETURNING id, name, lat, lng, radius_km * 1000 as radius, active, trucks, color, shape, polygon_coords',
              [mergedTrucks, polygonParent.id]
            );

            if (updatePolygon.rows.length > 0) {
              const updatedPolygon = updatePolygon.rows[0];
              updatedGeofences.push({ ...updatedPolygon, trucks: mergedTrucks });
              console.log(`✅ Successfully merged trucks into polygon "${polygonParent.name}"`);

              // Track affected trucks (old parent trucks + incoming)
              parentTrucks.forEach(t => allAffectedTrucks.add(t));
              incomingTrucks.forEach(t => allAffectedTrucks.add(t));
            } else {
              errors.push(`Failed to merge trucks into containing polygon "${polygonParent.name}" for ${name}`);
            }
          } catch (err) {
            console.error('Error merging trucks into polygon geofence:', err);
            errors.push(`Failed to merge trucks into containing polygon "${polygonParent.name}" for ${name}: ${err && err.message ? err.message : err}`);
          }

          // Do not create a new geofence for this contained entry; continue processing next input
          continue;
        }

        // If we get here, the point is not inside any polygon, so proceed with normal duplicate checking
        let existingGeofence = null;

        // Check for duplicate name
        const nameCheck = await client.query('SELECT id, trucks FROM geofences WHERE name = $1', [name]);
        if (nameCheck.rows.length > 0) {
          existingGeofence = nameCheck.rows[0];
        } else {
          // Check for duplicate centre point
          const pointCheck = await client.query('SELECT id, trucks FROM geofences WHERE lat = $1 AND lng = $2', [lat, lng]);
          if (pointCheck.rows.length > 0) {
            existingGeofence = pointCheck.rows[0];
          }
        }

        if (existingGeofence) {
          const oldTrucks = Array.isArray(existingGeofence.trucks) ? existingGeofence.trucks.map(String) : [];

          // Always overwrite the trucks list with the processed incoming list.
          // An explicit empty list or an omitted trucks field will now clear existing trucks.
          const result = await client.query(
            'UPDATE geofences SET trucks = $1 WHERE id = $2 RETURNING id, name, lat, lng, radius_km * 1000 as radius, active, trucks, color',
            [processedNewTrucks, existingGeofence.id]
          );

          if (result.rows.length > 0) {
            const updatedGeofence = result.rows[0];
            updatedGeofences.push({ ...updatedGeofence, trucks: processedNewTrucks });

            // Track affected trucks (old and new) so MQTT notifications go out
            oldTrucks.forEach(t => allAffectedTrucks.add(t));
            processedNewTrucks.forEach(t => allAffectedTrucks.add(t));
          }
        } else {
          // Check for overlap with existing geofences. If overlap found, merge incoming trucks into the nearest parent geofence
          const overlapCheck = await client.query(
            `SELECT id, trucks
             FROM geofences
             WHERE ST_DWithin(centre_point, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, (radius_km + $3) * 1000)
             ORDER BY ST_Distance(centre_point, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography)
             LIMIT 1`,
            [lng, lat, radiusKm]
          );

          if (overlapCheck.rows.length > 0) {
            // Found an existing parent/overlapping geofence — merge trucks into it instead of creating a nested geofence
            const parent = overlapCheck.rows[0];
            const parentTrucks = Array.isArray(parent.trucks) ? parent.trucks.map(String) : [];
            const incomingTrucks = processedNewTrucks.map(String);

            // Merge and deduplicate
            const mergedTrucks = [...new Set([...parentTrucks, ...incomingTrucks])];

            try {
              const updateParent = await client.query(
                'UPDATE geofences SET trucks = $1 WHERE id = $2 RETURNING id, name, lat, lng, radius_km * 1000 as radius, active, trucks, color',
                [mergedTrucks, parent.id]
              );

              if (updateParent.rows.length > 0) {
                const updatedParent = updateParent.rows[0];
                updatedGeofences.push({ ...updatedParent, trucks: mergedTrucks });

                // Track affected trucks (old parent trucks + incoming)
                parentTrucks.forEach(t => allAffectedTrucks.add(t));
                incomingTrucks.forEach(t => allAffectedTrucks.add(t));
              } else {
                errors.push(`Failed to merge trucks into overlapping geofence (parent id ${parent.id}) for ${name}`);
              }
            } catch (err) {
              console.error('Error merging trucks into parent geofence:', err);
              errors.push(`Failed to merge trucks into overlapping geofence (parent id ${parent.id}) for ${name}: ${err && err.message ? err.message : err}`);
            }

            // Do not create a new geofence for this overlapping entry; continue processing next input
            continue;
          }

          // Create new geofence using processed truck list
          const insertResult = await client.query(
            'INSERT INTO geofences (name, lat, lng, radius_km, active, trucks, color, centre_point) VALUES ($1, $2, $3, $4, $5, $6, $7, ST_GeogFromText($8)) RETURNING id, name, lat, lng, radius_km * 1000 as radius, active, trucks, color',
            [name, lat, lng, radiusKm, active, processedNewTrucks, generateRandomColor(), centrePoint]
          );

          if (insertResult.rows.length > 0) {
            const created = insertResult.rows[0];
            createdGeofences.push({ ...created, trucks: processedNewTrucks });
            processedNewTrucks.forEach(t => allAffectedTrucks.add(t));
          }
        }
      } catch (error) {
        console.error('Error processing geofence:', geofence && geofence.name, error);
        errors.push(`Failed to process geofence for ${geofence && geofence.name}: ${error && error.message ? error.message : error}`);
      }
    }

    await client.query('COMMIT');

    // Send MQTT update to all affected trucks
    await sendGeofenceUpdate(Array.from(allAffectedTrucks));

    res.status(200).json({
      created: createdGeofences,
      updated: updatedGeofences,
      errors: errors
    });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error in bulk geofence processing:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});



// City Dictionary endpoint - creates geofences without truck assignments
app.post('/api/geofences/city-dictionary', async (req, res) => {
  const geofences = req.body;

  if (!Array.isArray(geofences) || geofences.length === 0) {
    return res.status(400).json({ error: 'Invalid city dictionary data' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const createdGeofences = [];
    const errors = [];

    for (const geofence of geofences) {
      try {
        const { name, radius, wkt } = geofence;

        if (!name || !wkt) {
          errors.push(`Invalid geofence data for ${name || 'Unknown'}: missing name or WKT`);
          continue;
        }

        // Parse WKT geometry
        let shape, lat, lng, polygonCoords = null;

        if (wkt.startsWith('POINT')) {
          // Parse POINT (lng lat)
          const pointMatch = wkt.match(/POINT\s*\(\s*([-\d.]+)\s+([-\d.]+)\s*\)/i);
          if (!pointMatch) {
            errors.push(`Invalid POINT WKT for ${name}: ${wkt}`);
            continue;
          }
          lng = parseFloat(pointMatch[1]);
          lat = parseFloat(pointMatch[2]);
          shape = radius > 0 ? 'circle' : 'polygon'; // Use radius to determine shape
        } else if (wkt.startsWith('POLYGON')) {
          // Parse POLYGON ((lng1 lat1, lng2 lat2, ...))
          const polygonMatch = wkt.match(/POLYGON\s*\(\(\s*([^)]+)\s*\)\)/i);
          if (!polygonMatch) {
            errors.push(`Invalid POLYGON WKT for ${name}: ${wkt}`);
            continue;
          }

          const coordsText = polygonMatch[1];
          const coordPairs = coordsText.split(',').map(coord => coord.trim());
          polygonCoords = [];

          for (const pair of coordPairs) {
            const [lngStr, latStr] = pair.split(/\s+/);
            const lng = parseFloat(lngStr);
            const lat = parseFloat(latStr);

            if (isNaN(lng) || isNaN(lat)) {
              errors.push(`Invalid coordinates in POLYGON for ${name}: ${pair}`);
              continue;
            }

            polygonCoords.push({ lat, lng });
          }

          if (polygonCoords.length < 3) {
            errors.push(`POLYGON for ${name} must have at least 3 coordinates`);
            continue;
          }

          shape = 'polygon';
          // Calculate centroid for polygon
          const centroid = calculatePolygonCentroid(polygonCoords);
          lat = centroid.lat;
          lng = centroid.lng;
        } else {
          errors.push(`Unsupported WKT type for ${name}: ${wkt}`);
          continue;
        }

        // Check for duplicate name
        const nameCheck = await client.query('SELECT id FROM geofences WHERE name = $1', [name]);
        if (nameCheck.rows.length > 0) {
          errors.push(`Geofence name already exists: ${name}`);
          continue;
        }

        // For circles, check for duplicate center point and overlaps
        if (shape === 'circle' && radius > 0) {
          const pointCheck = await client.query('SELECT id FROM geofences WHERE lat = $1 AND lng = $2', [lat, lng]);
          if (pointCheck.rows.length > 0) {
            errors.push(`Geofence with same center point already exists: ${name}`);
            continue;
          }

          const radiusKm = radius / 1000;
          const centrePoint = `POINT(${lng} ${lat})`;

          const overlapCheck = await client.query(
            'SELECT id FROM geofences WHERE ST_DWithin(centre_point, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, (radius_km + $3) * 1000)',
            [lng, lat, radiusKm]
          );

          if (overlapCheck.rows.length > 0) {
            errors.push(`Geofence would intersect with existing geofence: ${name}`);
            continue;
          }

          // Create circle geofence
          const result = await client.query(
            'INSERT INTO geofences (name, lat, lng, radius_km, active, trucks, color, centre_point, shape) VALUES ($1, $2, $3, $4, $5, $6, $7, ST_GeogFromText($8), $9) RETURNING id, name, lat, lng, radius_km * 1000 as radius, active, trucks, color, shape',
            [name, lat, lng, radiusKm, true, [], generateRandomColor(), centrePoint, shape]
          );

          if (result.rows.length > 0) {
            createdGeofences.push(result.rows[0]);
          }
        } else if (shape === 'polygon' && polygonCoords) {
          // Create polygon geofence
          const radiusKm = 0; // Polygons don't have radius
          const centrePoint = `POINT(${lng} ${lat})`; // Use centroid

          const result = await client.query(
            'INSERT INTO geofences (name, lat, lng, radius_km, active, trucks, color, centre_point, shape, polygon_coords) VALUES ($1, $2, $3, $4, $5, $6, $7, ST_GeogFromText($8), $9, $10) RETURNING id, name, lat, lng, radius_km * 1000 as radius, active, trucks, color, shape, polygon_coords',
            [name, lat, lng, radiusKm, true, [], generateRandomColor(), centrePoint, shape, JSON.stringify(polygonCoords)]
          );

          if (result.rows.length > 0) {
            createdGeofences.push(result.rows[0]);
          }
        } else {
          errors.push(`Invalid geofence configuration for ${name}: shape=${shape}, radius=${radius}`);
        }

      } catch (error) {
        console.error('Error processing city dictionary geofence:', geofence && geofence.name, error);
        errors.push(`Failed to process geofence for ${geofence && geofence.name}: ${error && error.message ? error.message : error}`);
      }
    }

    await client.query('COMMIT');

    res.status(200).json({
      created: createdGeofences,
      errors: errors
    });

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error in city dictionary processing:', error);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// Geofence References CRUD endpoints
app.get('/api/geofence-references', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM switch_geofences_references ORDER BY incoming_name');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching geofence references:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/geofence-references', async (req, res) => {
  const { incoming_name, outgoing_name } = req.body;

  if (!incoming_name || !outgoing_name) {
    return res.status(400).json({ error: 'Both incoming_name and outgoing_name are required' });
  }

  try {
    // Check if outgoing_name exists as a geofence
    const existingGeofence = await pool.query('SELECT id FROM geofences WHERE name = $1', [outgoing_name]);
    if (existingGeofence.rows.length === 0) {
      return res.status(400).json({ error: 'Outgoing name must be an existing geofence' });
    }

    const result = await pool.query(
      'INSERT INTO switch_geofences_references (incoming_name, outgoing_name) VALUES ($1, $2) RETURNING *',
      [incoming_name, outgoing_name]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating geofence reference:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/geofence-references/:id', async (req, res) => {
  const { id } = req.params;
  const { incoming_name, outgoing_name } = req.body;

  if (!incoming_name || !outgoing_name) {
    return res.status(400).json({ error: 'Both incoming_name and outgoing_name are required' });
  }

  try {
    // Check if outgoing_name exists as a geofence
    const existingGeofence = await pool.query('SELECT id FROM geofences WHERE name = $1', [outgoing_name]);
    if (existingGeofence.rows.length === 0) {
      return res.status(400).json({ error: 'Outgoing name must be an existing geofence' });
    }

    const result = await pool.query(
      'UPDATE switch_geofences_references SET incoming_name = $1, outgoing_name = $2 WHERE id = $3 RETURNING *',
      [incoming_name, outgoing_name, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Geofence reference not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating geofence reference:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/geofence-references/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM switch_geofences_references WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Geofence reference not found' });
    }

    res.json({ message: 'Geofence reference deleted successfully' });
  } catch (error) {
    console.error('Error deleting geofence reference:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Geofence References V2 CRUD endpoints (improved architecture)
app.get('/api/geofence-references-v2', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT gr.*, g.name as geofence_name
      FROM geofence_references gr
      LEFT JOIN geofences g ON gr.geofence_id = g.id
      ORDER BY gr.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching geofence references v2:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/api/geofence-references-v2', async (req, res) => {
  const { geofence_id, incoming_names } = req.body;

  if (!geofence_id || !Array.isArray(incoming_names) || incoming_names.length === 0) {
    return res.status(400).json({ error: 'geofence_id and non-empty incoming_names array are required' });
  }

  try {
    // Check if geofence exists
    const geofenceCheck = await pool.query('SELECT id FROM geofences WHERE id = $1', [geofence_id]);
    if (geofenceCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Geofence not found' });
    }

    // Check for duplicate incoming names across all references (v1 and v2, allow but warn)
    const existingNamesV2 = await pool.query(`
      SELECT gr.id, geofence_id, incoming_names, g.name as geofence_name
      FROM geofence_references gr
      LEFT JOIN geofences g ON gr.geofence_id = g.id
      WHERE incoming_names && $1
    `, [incoming_names]);

    // Also check v1 references
    const existingNamesV1 = await pool.query(`
      SELECT id, incoming_name, outgoing_name
      FROM switch_geofences_references
      WHERE LOWER(incoming_name) = ANY($1)
    `, [incoming_names.map(name => name.toLowerCase())]);

    const result = await pool.query(
      'INSERT INTO geofence_references (geofence_id, incoming_names) VALUES ($1, $2) RETURNING *',
      [geofence_id, incoming_names]
    );

    // Include warnings if there were conflicts (check both v1 and v2)
    const response = result.rows[0];
    const allConflicts = [];

    // Process v2 conflicts
    if (existingNamesV2.rows.length > 0) {
      const v2Conflicts = existingNamesV2.rows
        .map(row => {
          const overlapping = row.incoming_names.filter(name =>
            incoming_names.some(newName => newName.toLowerCase() === name.toLowerCase())
          );
          return {
            conflicting_reference_id: row.id,
            geofence_id: row.geofence_id,
            geofence_name: row.geofence_name,
            conflicting_names: overlapping,
            reference_type: 'v2'
          };
        })
        .filter(conflict => conflict.conflicting_names.length > 0);
      allConflicts.push(...v2Conflicts);
    }

    // Process v1 conflicts
    if (existingNamesV1.rows.length > 0) {
      const v1Conflicts = existingNamesV1.rows.map(row => ({
        conflicting_reference_id: row.id,
        geofence_name: row.outgoing_name, // This is the geofence name in v1
        conflicting_names: [row.incoming_name],
        reference_type: 'v1'
      }));
      allConflicts.push(...v1Conflicts);
    }

    if (allConflicts.length > 0) {
      response.warnings = {
        message: 'Some incoming names are already used in other references',
        conflicts: allConflicts
      };
    }

    res.status(201).json(response);
  } catch (error) {
    console.error('Error creating geofence reference v2:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.put('/api/geofence-references-v2/:id', async (req, res) => {
  const { id } = req.params;
  const { geofence_id, incoming_names } = req.body;

  if (!geofence_id || !Array.isArray(incoming_names) || incoming_names.length === 0) {
    return res.status(400).json({ error: 'geofence_id and non-empty incoming_names array are required' });
  }

  try {
    // Check if geofence exists
    const geofenceCheck = await pool.query('SELECT id FROM geofences WHERE id = $1', [geofence_id]);
    if (geofenceCheck.rows.length === 0) {
      return res.status(400).json({ error: 'Geofence not found' });
    }

    // Check for duplicate incoming names (excluding current reference, allow but warn)
    const existingNamesV2 = await pool.query(`
      SELECT gr.id, geofence_id, incoming_names, g.name as geofence_name
      FROM geofence_references gr
      LEFT JOIN geofences g ON gr.geofence_id = g.id
      WHERE gr.id != $1 AND incoming_names && $2
    `, [id, incoming_names]);

    // Also check v1 references
    const existingNamesV1 = await pool.query(`
      SELECT id, incoming_name, outgoing_name
      FROM switch_geofences_references
      WHERE LOWER(incoming_name) = ANY($1)
    `, [incoming_names.map(name => name.toLowerCase())]);

    const result = await pool.query(
      'UPDATE geofence_references SET geofence_id = $1, incoming_names = $2 WHERE id = $3 RETURNING *',
      [geofence_id, incoming_names, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Geofence reference v2 not found' });
    }

    // Include warnings if there were conflicts (check both v1 and v2)
    const response = result.rows[0];
    const allConflicts = [];

    // Process v2 conflicts
    if (existingNamesV2.rows.length > 0) {
      const v2Conflicts = existingNamesV2.rows
        .map(row => {
          const overlapping = row.incoming_names.filter(name =>
            incoming_names.some(newName => newName.toLowerCase() === name.toLowerCase())
          );
          return {
            conflicting_reference_id: row.id,
            geofence_id: row.geofence_id,
            geofence_name: row.geofence_name,
            conflicting_names: overlapping,
            reference_type: 'v2'
          };
        })
        .filter(conflict => conflict.conflicting_names.length > 0);
      allConflicts.push(...v2Conflicts);
    }

    // Process v1 conflicts
    if (existingNamesV1.rows.length > 0) {
      const v1Conflicts = existingNamesV1.rows.map(row => ({
        conflicting_reference_id: row.id,
        geofence_name: row.outgoing_name, // This is the geofence name in v1
        conflicting_names: [row.incoming_name],
        reference_type: 'v1'
      }));
      allConflicts.push(...v1Conflicts);
    }

    if (allConflicts.length > 0) {
      response.warnings = {
        message: 'Some incoming names are already used in other references',
        conflicts: allConflicts
      };
    }

    res.json(response);
  } catch (error) {
    console.error('Error updating geofence reference v2:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/api/geofence-references-v2/:id', async (req, res) => {
  const { id } = req.params;

  try {
    const result = await pool.query('DELETE FROM geofence_references WHERE id = $1 RETURNING *', [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Geofence reference v2 not found' });
    }

    res.json({ message: 'Geofence reference v2 deleted successfully' });
  } catch (error) {
    console.error('Error deleting geofence reference v2:', error);
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
      LIMIT 1000
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
    const result = await pool.query("SELECT * FROM vehicle_info WHERE company_id = 'e5a99ee4-4306-4065-bacd-876004cf1555' ORDER BY id");
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching trucks:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/trucks/:device_serial', async (req, res) => {
  try {
    const { device_serial } = req.params;
    const result = await pool.query(
      "SELECT * FROM vehicle_info WHERE device_serial = $1 AND company_id = 'e5a99ee4-4306-4065-bacd-876004cf1555'",
      [device_serial]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching vehicle:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/trucks/:device_serial/alerts', async (req, res) => {
  try {
    const { device_serial } = req.params;
    const { limit = 50 } = req.query;

    // Verify the vehicle exists and belongs to the company
    const vehicleResult = await pool.query(
      "SELECT device_serial FROM vehicle_info WHERE device_serial = $1 AND company_id = 'e5a99ee4-4306-4065-bacd-876004cf1555'",
      [device_serial]
    );

    if (vehicleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    // Get alerts for this vehicle
    const alertsResult = await pool.query(
      `SELECT a.*
       FROM alert_ts a
       WHERE a.device_serial::text = $1
       ORDER BY a.time DESC
       LIMIT $2`,
      [device_serial, parseInt(limit)]
    );

    res.json(alertsResult.rows);
  } catch (error) {
    console.error('Error fetching vehicle alerts:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/trucks/:device_serial/trips', async (req, res) => {
  try {
    const { device_serial } = req.params;
    const { start, end, limit = 20 } = req.query;

    // First check if vehicle exists
    const vehicleResult = await pool.query(
      "SELECT * FROM vehicle_info WHERE device_serial = $1 AND company_id = 'e5a99ee4-4306-4065-bacd-876004cf1555'",
      [device_serial]
    );

    if (vehicleResult.rows.length === 0) {
      return res.status(404).json({ error: 'Vehicle not found' });
    }

    let query;
    let params = [device_serial];

    if (start && end) {
      // Get trip data between specific dates
      query = `
        SELECT
          gps.device_serial,
          ST_AsText(gps.location) as location,
          gps.speed,
          gps.time,
          CONCAT(v.vehicle_name, ' ', v.vehicle_model, ' ', v.vehicle_year) AS vehicle_full_name
        FROM gps_ts gps
        LEFT JOIN vehicle_info v ON gps.device_serial::text = v.device_serial
        WHERE gps.device_serial = $1::bigint
          AND gps.time >= EXTRACT(EPOCH FROM $2::timestamp)
          AND gps.time <= EXTRACT(EPOCH FROM $3::timestamp)
        ORDER BY gps.time ASC
      `;
      params = [device_serial, start, end];
    } else {
      // Get latest trips (last 30 days by default)
      const thirtyDaysAgo = new Date();
      thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

      query = `
        SELECT
          gps.device_serial,
          ST_AsText(gps.location) as location,
          gps.speed,
          gps.time,
          CONCAT(v.vehicle_name, ' ', v.vehicle_model, ' ', v.vehicle_year) AS vehicle_full_name
        FROM gps_ts gps
        LEFT JOIN vehicle_info v ON gps.device_serial::text = v.device_serial
        WHERE gps.device_serial = $1::bigint
          AND gps.time >= EXTRACT(EPOCH FROM $2::timestamp)
        ORDER BY gps.time DESC
        LIMIT $3
      `;
      params = [device_serial, thirtyDaysAgo.toISOString(), parseInt(limit)];
    }

    const result = await pool.query(query, params);

    // Process the GPS data to extract lat/lng and group into trips
    const gpsPoints = result.rows.map(row => {
      const match = row.location.match(/POINT\(([^ ]+) ([^)]+)\)/);
      if (match) {
        return {
          device_serial: row.device_serial,
          lat: parseFloat(match[2]),
          lng: parseFloat(match[1]),
          speed: row.speed,
          time: row.time,
          vehicle_full_name: row.vehicle_full_name
        };
      }
      return null;
    }).filter(point => point !== null);

    // Group GPS points into trips based on time gaps and speed
    const trips = [];
    let currentTrip = null;
    let tripId = 1;

    for (const point of gpsPoints) {
      const pointTime = new Date(point.time * 1000);

      if (!currentTrip) {
        // Start new trip
        currentTrip = {
          id: tripId++,
          start_time: pointTime.toISOString(),
          end_time: pointTime.toISOString(),
          points: [point],
          max_speed: point.speed,
          total_distance: 0,
          start_lat: point.lat,
          start_lng: point.lng,
          end_lat: point.lat,
          end_lng: point.lng
        };
      } else {
        const timeDiff = pointTime.getTime() - new Date(currentTrip.end_time).getTime();
        const isNewTrip = timeDiff > (2 * 60 * 60 * 1000); // 2 hours gap = new trip

        if (isNewTrip) {
          // Finalize current trip
          trips.push({
            id: currentTrip.id,
            start_time: currentTrip.start_time,
            end_time: currentTrip.end_time,
            distance_km: Math.round(currentTrip.total_distance * 100) / 100,
            max_speed: Math.round(currentTrip.max_speed),
            average_speed: Math.round(currentTrip.points.reduce((sum, p) => sum + p.speed, 0) / currentTrip.points.length),
            fuel_consumed: Math.round(currentTrip.total_distance * 0.08), // Rough estimate: 8L per 100km
            start_location: `${currentTrip.start_lat.toFixed(4)}, ${currentTrip.start_lng.toFixed(4)}`,
            end_location: `${currentTrip.end_lat.toFixed(4)}, ${currentTrip.end_lng.toFixed(4)}`,
            points: currentTrip.points
          });

          // Start new trip
          currentTrip = {
            id: tripId++,
            start_time: pointTime.toISOString(),
            end_time: pointTime.toISOString(),
            points: [point],
            max_speed: point.speed,
            total_distance: 0,
            start_lat: point.lat,
            start_lng: point.lng,
            end_lat: point.lat,
            end_lng: point.lng
          };
        } else {
          // Continue current trip
          currentTrip.end_time = pointTime.toISOString();
          currentTrip.end_lat = point.lat;
          currentTrip.end_lng = point.lng;
          currentTrip.max_speed = Math.max(currentTrip.max_speed, point.speed);

          // Calculate distance from last point (rough calculation)
          const lastPoint = currentTrip.points[currentTrip.points.length - 1];
          const distance = Math.sqrt(
            Math.pow(point.lat - lastPoint.lat, 2) + Math.pow(point.lng - lastPoint.lng, 2)
          ) * 111; // Rough km conversion
          currentTrip.total_distance += distance;

          currentTrip.points.push(point);
        }
      }
    }

    // Add the last trip if it exists
    if (currentTrip && currentTrip.points.length > 1) {
      trips.push({
        id: currentTrip.id,
        start_time: currentTrip.start_time,
        end_time: currentTrip.end_time,
        distance_km: Math.round(currentTrip.total_distance * 100) / 100,
        max_speed: Math.round(currentTrip.max_speed),
        average_speed: Math.round(currentTrip.points.reduce((sum, p) => sum + p.speed, 0) / currentTrip.points.length),
        fuel_consumed: Math.round(currentTrip.total_distance * 0.08),
        start_location: `${currentTrip.start_lat.toFixed(4)}, ${currentTrip.start_lng.toFixed(4)}`,
        end_location: `${currentTrip.end_lat.toFixed(4)}, ${currentTrip.end_lng.toFixed(4)}`,
        points: currentTrip.points
      });
    }

    res.json(trips.reverse()); // Return most recent trips first
  } catch (error) {
    console.error('Error fetching vehicle trips:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/api/ignitionStatus', async (req, res) => {
  try {
    // Check if a specific serial is requested
    const { serial } = req.query;

    let query;
    let params;

    if (serial) {
      // Fetch ignition status for a specific device serial
      query = `
        SELECT * FROM engine_ts
        WHERE device_serial = $1::bigint
        AND device_serial::text IN (
          SELECT device_serial
          FROM vehicle_info
          WHERE company_id = 'e5a99ee4-4306-4065-bacd-876004cf1555'
        )
        ORDER BY time DESC
        LIMIT 1
      `;
      params = [serial];
    } else {
      // Fetch latest ignition status for all devices from the company
      query = `
        SELECT DISTINCT ON (device_serial) *
        FROM engine_ts
        WHERE device_serial::text IN (
          SELECT device_serial
          FROM vehicle_info
          WHERE company_id = 'e5a99ee4-4306-4065-bacd-876004cf1555'
        )
        ORDER BY device_serial, time DESC
      `;
      params = [];
    }

    const result = await pool.query(query, params);
    console.log('Ignition Status API response:', result.rows.length, 'records', serial ? `for serial ${serial}` : 'for all devices');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching ignition status:', err);
    res.status(500).json({ error: "Database error", details: err.message });
  }
});

app.get('/api/alerts/latest200', async (req, res)=>{


 try {
        const result = await pool.query(`
            SELECT a.*
            FROM alert_ts a
            INNER JOIN vehicle_info vi ON a.device_serial::text = vi.device_serial
            WHERE vi.company_id = 'e5a99ee4-4306-4065-bacd-876004cf1555'
            ORDER BY a.time DESC
            LIMIT 200
        `);
        console.log('latest 200 filtered by company', result.rows.length)
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Database error", details: err.message });
    }


});
app.get('/api/alerts/latest', async (req, res)=>{


 try {
        const result = await pool.query(`
            SELECT DISTINCT ON (a.device_serial) a.*
            FROM alert_ts a
            INNER JOIN vehicle_info vi ON a.device_serial::text = vi.device_serial
            WHERE vi.company_id = 'e5a99ee4-4306-4065-bacd-876004cf1555'
            ORDER BY a.device_serial, a.time DESC
        `);
        console.log('latest alerts filtered by company', result.rows.length)
        res.json(result.rows);
    } catch (err) {
        res.status(500).json({ error: "Database error", details: err.message });
    }


});









// Test route to simulate MQTT logs message for debugging
app.get('/test-logs/:serial', (req, res) => {
  const { serial } = req.params;
  const testTopic = `ekco/v1/${serial}/logs/data`;
  const testPayload = `Test log message from server at ${new Date().toISOString()}`;

  console.log(`[TEST] Simulating MQTT logs message for serial ${serial}`);

  // Simulate what the MQTT handler does
  const matchLogs = testTopic.match(/^ekco\/v1\/(.+)\/logs\/data$/);
  if (matchLogs) {
    const serialNum = matchLogs[1];
    console.log(`[TEST] Matched serial: ${serialNum}`);

    if (activeStreams[serialNum] && activeStreams[serialNum].logs) {
      console.log(`[TEST] Found ${activeStreams[serialNum].logs.length} active SSE clients for serial ${serialNum}`);
      activeStreams[serialNum].logs.forEach((resStream, index) => {
        try {
          const dataToSend = `data: ${JSON.stringify({ topic: testTopic, payload: testPayload })}\n\n`;
          console.log(`[TEST] Sending to client ${index}: ${dataToSend.substring(0, 100)}...`);
          resStream.write(dataToSend);
          console.log(`[TEST] Successfully sent test log to SSE client ${index}`);
        } catch (writeError) {
          console.error(`[TEST] Error writing to SSE client ${index}:`, writeError);
        }
      });
      res.send(`Test logs message sent to ${activeStreams[serialNum].logs.length} SSE clients for serial ${serial}`);
    } else {
      console.log(`[TEST] No active SSE streams found for serial ${serialNum}`);
      res.send(`No active SSE streams found for serial ${serial}. Make sure the DeviceLogs component is connected first.`);
    }
  } else {
    res.send(`Invalid topic format for serial ${serial}`);
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
app.use('/api', deviceHealthRoutes);

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

// Vehicle Lock Control Routes - Unified endpoint to match old app
app.post('/api/lockVehicle', async (req, res) => {
  try {
    await lockVehicle(req, res);
  } catch (error) {
    console.error('Lock vehicle error:', error);
    res.status(500).json({ error: 'Failed to control vehicle lock' });
  }
});

app.get('/api/lock-status/:serial_number', async (req, res) => {
  try {
    await getLockStatus(req, res);
  } catch (error) {
    console.error('Lock status error:', error);
    res.status(500).json({ error: 'Failed to get lock status' });
  }
});

// Trip reports endpoint - returns multiple trip reports with GPS paths
app.get('/api/trips/:device_serial', async (req, res) => {
  const { device_serial } = req.params;
  const { start, end } = req.query;
  try {
      let query = "SELECT * FROM trips WHERE device_serial = $1";
      let params = [device_serial];

      if (start && end) {
          query += " AND start_time >= EXTRACT(EPOCH FROM $2::timestamp) AND end_time <= EXTRACT(EPOCH FROM $3::timestamp)";
          params = [device_serial, start, end];
      }

      query += " ORDER BY start_time DESC";

      const tripsResult = await pool.query(query, params);
      const tripsWithPath = await Promise.all(
          tripsResult.rows.map(async (trip) => {
              const pathResult = await pool.query(
                  `SELECT
                    time,
                    ST_X(location::geometry) AS longitude,
                    ST_Y(location::geometry) AS latitude,
                    speed
                  FROM gps_ts
                  WHERE device_serial = $1
                    AND time BETWEEN $2 AND $3
                  ORDER BY time`,
                  [device_serial, trip.start_time, trip.end_time]
              );
              return {
                  ...trip,
                  path: pathResult.rows,
              };
          })
      );
      res.json(tripsWithPath);
  } catch (err) {
      res.status(500).json({ error: "Database error", details: err.message });
  }
});

// Helper function to calculate distance from WKB path points
function calculateDistance(path) {
  if (!path || path.length < 2) return 0;

  let totalDistance = 0;

  for (let i = 1; i < path.length; i++) {
    const point1 = parseWKBPoint(path[i-1]);
    const point2 = parseWKBPoint(path[i]);

    if (point1 && point2) {
      const distance = getDistance(point1.lat, point1.lng, point2.lat, point2.lng);
      totalDistance += distance;
    }
  }

  return Math.round(totalDistance * 100) / 100; // Round to 2 decimal places
}

// Helper function to parse WKB POINT string
function parseWKBPoint(wkbString) {
  const match = wkbString.match(/POINT\(([^ ]+) ([^)]+)\)/);
  if (match) {
    return {
      lng: parseFloat(match[1]),
      lat: parseFloat(match[2])
    };
  }
  return null;
}

// Helper function to calculate distance between two lat/lng points in km
function getDistance(lat1, lng1, lat2, lng2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLng/2) * Math.sin(dLng/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

//Render client
//uodated client





app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// ---------------- MQTT Logs Functionality ---------------- //

// In-memory log storage: { serial_number: [serial1, log2, ...] }
const logsMap = {};

// Track active SSE streams per serial_number
const activeStreams = {};



// Track active retrieve/stream connections (now handled by activeStreams)

app.get('/logs/:serial_number/retrieve/stream', (req, res) => {
  const { serial_number } = req.params;
  const command = "1";
  const controlTopic = `ekco/v1/${serial_number}/logs/control`;

  console.log(`[SSE] Setting up stream for serial: ${serial_number}`);

  req.socket.setTimeout(0);
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.flushHeaders();

  // Set up activeStreams for the global MQTT handler to use
  if (!activeStreams[serial_number]) {
    activeStreams[serial_number] = { logs: [] };
  }
  activeStreams[serial_number].logs.push(res);
  console.log(`[SSE] Added SSE client for serial ${serial_number}. Total clients: ${activeStreams[serial_number].logs.length}`);

  mqttClient.publish(controlTopic, String(command), { retain: false }, (err) => {
    if (err) {
      console.error(`[SSE] Failed to publish control command to ${controlTopic}:`, err);
      res.write(`event: error\ndata: ${JSON.stringify({ error: 'Failed to publish control command', details: err.message })}\n\n`);
      res.end();
      // Remove from activeStreams
      if (activeStreams[serial_number] && activeStreams[serial_number].logs) {
        activeStreams[serial_number].logs = activeStreams[serial_number].logs.filter(r => r !== res);
      }
    } else {
      console.log(`[SSE] Successfully published start command to ${controlTopic}`);
      // Send a connection confirmation message
      res.write(`data: ${JSON.stringify({ topic: 'connection', payload: 'SSE connection established for serial ' + serial_number })}\n\n`);
    }
  });

  req.on('close', () => {
    console.log(`[SSE] SSE connection closed for serial ${serial_number}`);
    // Remove from activeStreams when connection closes
    if (activeStreams[serial_number] && activeStreams[serial_number].logs) {
      activeStreams[serial_number].logs = activeStreams[serial_number].logs.filter(r => r !== res);
      console.log(`[SSE] Removed SSE client for serial ${serial_number}. Remaining clients: ${activeStreams[serial_number].logs.length}`);
    }
  });
});

app.post('/logs/:serial_number/retrieve/stream/stop', (req, res) => {
  const { serial_number } = req.params;
  const controlTopic = `ekco/v1/${serial_number}/logs/control`;

  mqttClient.publish(controlTopic, "0", { retain: false }, (err) => {
    if (err) {
      console.error(`Failed to send stop command to ${controlTopic}:`, err);
    }
  });

  // Close all active SSE streams for this serial
  if (activeStreams[serial_number] && activeStreams[serial_number].logs) {
    activeStreams[serial_number].logs.forEach(streamRes => {
      streamRes.write('event: end\ndata: Stream stopped by server\n\n');
      streamRes.end();
    });
    activeStreams[serial_number].logs = [];
  }

  // Always 200 OK
  res.json({ message: `Stop command sent for ${serial_number}` });
});

//Render client
//uodated client
app.get('*', (req, res)=>{
    res.sendFile(path.join(__dirname,'/client/dist/index.html'))
});

// Server and WebSocket setup moved to startServer() function above





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
  if (!wss) {
    console.warn('WebSocket server not initialized yet');
    return;
  }
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
const gracefulShutdown = async () => {
  console.log('Shutting down gracefully...');

  try {
    // Close database pool with timeout
    await Promise.race([
      pool.end(),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Pool end timeout')), 5000)
      )
    ]);
    console.log('Database connections closed successfully.');
  } catch (err) {
    console.error('Error closing database connections:', err.message);
    // Force close anyway
    pool.end(() => {});
  }

  process.exit(0);
};

// Handle multiple termination signals
process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  gracefulShutdown();
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  gracefulShutdown();
});

// Helper: normalize incoming truck identifiers to canonical device_serial values using vehicle_info.
// If an identifier (device_serial, vehicle_reg or fleet_number) doesn't exist, insert a minimal vehicle_info row.
// Helper: normalize incoming truck identifiers to canonical device_serial values using vehicle_info.
// If an identifier (device_serial, vehicle_reg or fleet_number) doesn't exist, DO NOT create a new vehicle_info row.
// Instead return the normalized device_serials and the list of missing identifiers so callers can decide how to handle them.
async function normalizeTruckIdentifiers(client, truckInputs = []) {
  const normalized = [];
  const missing = [];

  for (const raw of truckInputs || []) {
    try {
      const idStr = String(raw || '').trim();
      if (!idStr) continue;

      // Find existing vehicle by device_serial, vehicle_reg or fleet_number
      const found = await client.query(
        `SELECT device_serial FROM vehicle_info
         WHERE device_serial = $1 OR vehicle_reg = $1 OR fleet_number = $1
         LIMIT 1`,
        [idStr]
      );

      if (found.rows.length > 0 && found.rows[0].device_serial) {
        normalized.push(String(found.rows[0].device_serial));
      } else {
        // Not found: record as missing (do NOT insert)
        missing.push(idStr);
      }
    } catch (err) {
      console.warn('normalizeTruckIdentifiers error for', raw, err && err.message ? err.message : err);
      // On lookup error, mark identifier as missing for safety
      try {
        const idStr = String(raw || '').trim();
        if (idStr) missing.push(idStr);
      } catch (ignore) {}
    }
  }

  // Deduplicate preserving order
  const uniqueNormalized = [...new Set(normalized)];
  const uniqueMissing = [...new Set(missing.filter(m => !uniqueNormalized.includes(m)))];

  return { normalized: uniqueNormalized, missing: uniqueMissing };
}

// Geocoding endpoint for reverse geocoding addresses
app.get('/api/geocode/reverse', async (req, res) => {
  try {
    const { lat, lng } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ error: 'Latitude and longitude are required' });
    }

    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);

    if (isNaN(latNum) || isNaN(lngNum)) {
      return res.status(400).json({ error: 'Invalid latitude or longitude' });
    }

    // Use Google Maps Geocoding API
    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Google Maps API key not configured' });
    }

    const geocodeUrl = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${latNum},${lngNum}&key=${apiKey}`;

    const response = await fetch(geocodeUrl);
    const data = await response.json();

    if (data.status === 'OK' && data.results && data.results.length > 0) {
      const result = data.results[0];
      res.json({
        address: result.formatted_address,
        place_id: result.place_id,
        location: {
          lat: latNum,
          lng: lngNum
        },
        components: result.address_components
      });
    } else {
      res.status(404).json({ error: 'No address found for these coordinates' });
    }
  } catch (error) {
    console.error('Geocoding error:', error);
    res.status(500).json({ error: 'Geocoding service error' });
  }
});
