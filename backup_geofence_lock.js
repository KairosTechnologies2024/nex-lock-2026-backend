require('dotenv').config();

const { Pool } = require('pg');
const mqtt = require('mqtt');
const config = require('./backup_config');


const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,


  max: 10,                    
  min: 1,                    

 
  idleTimeoutMillis: 60000,   
  connectionTimeoutMillis: 10000, 


  query_timeout: 30000,     
  statement_timeout: 30000,   // 30 second statement timeout

  ssl: false
});

const mqttClient = mqtt.connect("mqtt://ekco-tracking.co.za:1883", {
  username: "dev:ekcoFleets",
  password: "dzRND6ZqiI"
});


let lastProcessedTimestamp = Math.floor(Date.now() / 1000) - 60;
const truckGeofenceStates = new Map(); 


const { POLL_INTERVAL } = config;

async function processGPSData() {
  const startTime = Date.now();
  try {
    console.log(`🔍 [${new Date().toISOString()}] Backup: Starting GPS data processing from timestamp ${lastProcessedTimestamp}`);

    const gpsQuery = `
      SELECT DISTINCT
        g.device_serial,
        ST_X(g.location::geometry) as longitude,
        ST_Y(g.location::geometry) as latitude,
        g.time,
        g.speed,
        v.company_id,
        v.registration_number
      FROM gps_ts g
      INNER JOIN vehicle_info v ON g.device_serial::text = v.device_serial::text
      WHERE g.time > $1::bigint
        AND v.company_id = 'e5a99ee4-4306-4065-bacd-876004cf1555'
      ORDER BY g.device_serial, g.time DESC
    `;
    console.log(`🔍 [${new Date().toISOString()}] Backup: Executing query: ${gpsQuery.trim()}`);
    console.log(`🔍 [${new Date().toISOString()}] Backup: With parameter: ${lastProcessedTimestamp} (type: ${typeof lastProcessedTimestamp})`);

    const gpsResult = await pool.query(gpsQuery, [lastProcessedTimestamp]);

    console.log(`📊 [${new Date().toISOString()}] Backup: Found ${gpsResult.rows.length} GPS records for authorized company vehicles`);

    if (gpsResult.rows.length === 0) {
      console.log(`ℹ️ [${new Date().toISOString()}] Backup: No new GPS data to process`);
      return;
    }

    const latestPositions = new Map();
    for (const row of gpsResult.rows) {
      if (!latestPositions.has(row.device_serial) ||
          row.time > latestPositions.get(row.device_serial).time) {
        latestPositions.set(row.device_serial, row);
      }
    }

    console.log(`🚛 [${new Date().toISOString()}] Backup: Processing ${latestPositions.size} unique vehicles`);

    let processedCount = 0;
    for (const [deviceSerial, gpsData] of latestPositions) {
      console.log(`🔄 [${new Date().toISOString()}] Backup: Processing vehicle ${deviceSerial} (${gpsData.registration_number}) at ${gpsData.latitude}, ${gpsData.longitude}`);
      await checkGeofenceStatus(deviceSerial, gpsData);
      processedCount++;
    }

    lastProcessedTimestamp = Math.max(...gpsResult.rows.map(r => parseInt(r.time)));

    const processingTime = Date.now() - startTime;
    console.log(`✅ [${new Date().toISOString()}] Backup: Completed processing ${processedCount} vehicles in ${processingTime}ms`);

  } catch (error) {
    console.error(`❌ [${new Date().toISOString()}] Backup: Error processing GPS data:`, error);
  }
}

async function checkGeofenceStatus(deviceSerial, gpsData) {
  const checkStartTime = Date.now();
  try {
    const { longitude, latitude, time, registration_number, speed } = gpsData;

    console.log(`🎯 [${new Date().toISOString()}] Backup: Checking geofence status for ${deviceSerial} (${registration_number}) at ${latitude.toFixed(6)}, ${longitude.toFixed(6)}, speed: ${speed} km/h`);

    const geofenceQuery = `
      SELECT
        g.id,
        g.name,
        g.shape,
        g.radius_km,
        CASE
          WHEN g.shape = 'circle' THEN
            ST_DWithin(g.centre_point, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, g.radius_km * 1000)
          WHEN g.shape = 'polygon' AND g.polygon_coords IS NOT NULL THEN
            ST_Contains(ST_GeomFromText(
              'POLYGON((' ||
              (SELECT string_agg(lng || ' ' || lat, ', ') FROM jsonb_array_elements(g.polygon_coords) AS elem(obj) CROSS JOIN LATERAL jsonb_to_record(elem.obj) AS (lng float, lat float)) ||
              ', ' ||
              (SELECT lng || ' ' || lat FROM jsonb_array_elements(g.polygon_coords) AS elem(obj) CROSS JOIN LATERAL jsonb_to_record(elem.obj) AS (lng float, lat float) LIMIT 1) ||
              '))'
            , 4326), ST_GeomFromText(CONCAT('POINT(', $1, ' ', $2, ')'), 4326))
          ELSE false
        END as inside_geofence
      FROM geofences g
      WHERE g.active = true
    `;
    console.log(`🎯 [${new Date().toISOString()}] Backup: Executing geofence query for ${deviceSerial}`);
    console.log(`🎯 [${new Date().toISOString()}] Backup: Parameters: longitude=${longitude}, latitude=${latitude}`);

    const geofenceResult = await pool.query(geofenceQuery, [longitude, latitude]);

    console.log(`🏁 [${new Date().toISOString()}] Backup: Found ${geofenceResult.rows.length} active geofences`);

    const isInsideAnyFence = geofenceResult.rows.some(geofence => geofence.inside_geofence);

    const wasInsideAnyFence = truckGeofenceStates.get(deviceSerial) || false;

    const insideFences = geofenceResult.rows.filter(g => g.inside_geofence).map(g => `${g.name} (${g.shape})`);
    const outsideFences = geofenceResult.rows.filter(g => !g.inside_geofence).map(g => g.name);

    console.log(`📍 [${new Date().toISOString()}] Backup: ${deviceSerial} (${registration_number}) - Inside: [${insideFences.join(', ')}], Outside: [${outsideFences.join(', ')}]`);

    if (wasInsideAnyFence !== isInsideAnyFence) {
      const statusChange = wasInsideAnyFence ? 'EXITED' : 'ENTERED';
      console.log(`⚡ [${new Date().toISOString()}] Backup: STATUS CHANGE - ${deviceSerial} (${registration_number}) ${statusChange} geofence zone`);
      await handleGlobalGeofenceEvent(deviceSerial, isInsideAnyFence, time, registration_number);
      truckGeofenceStates.set(deviceSerial, isInsideAnyFence);
    } else {
      console.log(`✅ [${new Date().toISOString()}] Backup: No status change for ${deviceSerial} (${registration_number}) - ${isInsideAnyFence ? 'inside' : 'outside'} geofence zone`);
    }

    const checkTime = Date.now() - checkStartTime;
    console.log(`⏱️ [${new Date().toISOString()}] Backup: Geofence check for ${deviceSerial} completed in ${checkTime}ms`);

  } catch (error) {
    console.error(`❌ [${new Date().toISOString()}] Backup: Error checking geofence status for ${deviceSerial}:`, error);
  }
}

async function handleGlobalGeofenceEvent(deviceSerial, isInsideAnyFence, timestamp, registrationNumber) {
  const eventStartTime = Date.now();

  const shouldLock = !isInsideAnyFence; // lock when outside all fences
  const action = shouldLock ? 'lock' : 'unlock';
  const eventType = isInsideAnyFence ? 'entering fence zone' : 'exiting all fence zones';

  console.log(`🚨 [${new Date().toISOString()}] Backup: GLOBAL GEOFENCE EVENT - ${deviceSerial} (${registrationNumber}) ${eventType.toUpperCase()}`);
  console.log(`🔐 [${new Date().toISOString()}] Backup: Initiating ${action.toUpperCase()} command for ${deviceSerial} (${registrationNumber})`);

  try {

    const commandStartTime = Date.now();
    await sendLockCommand(deviceSerial, shouldLock ? 1 : 0);
    const commandTime = Date.now() - commandStartTime;

    console.log(`✅ [${new Date().toISOString()}] Backup: ${action.toUpperCase()} command sent successfully to ${deviceSerial} (${registrationNumber}) in ${commandTime}ms`);
    console.log(`🔒 [${new Date().toISOString()}] Backup: ${action.toUpperCase()} truck ${deviceSerial} (${registrationNumber}) due to ${eventType} at ${new Date(timestamp * 1000).toISOString()}`);

   
    await pool.query(`
      INSERT INTO geofence_alert_ts (time, geofence_id, device_serial, alert)
      VALUES ($1, $2, $3::bigint, $4)
    `, [timestamp, null, deviceSerial, isInsideAnyFence ? `GLOBAL_INSIDE_ALL_FENCES SCRIPT - ${registrationNumber}` : 'OUTSIDE GEOFENCE']);

    console.log(`📝 [${new Date().toISOString()}] Backup: Geofence alert logged to database for ${deviceSerial} (${registrationNumber})`);

    const totalEventTime = Date.now() - eventStartTime;
    console.log(`🏁 [${new Date().toISOString()}] Backup: Global geofence event handling completed for ${deviceSerial} (${registrationNumber}) in ${totalEventTime}ms`);

  } catch (error) {
    console.error(`❌ [${new Date().toISOString()}] Backup: Failed to handle global geofence event for ${deviceSerial} (${registrationNumber}):`, error);
    console.error(`📊 [${new Date().toISOString()}] Backup: Event details - Action: ${action}, Event: ${eventType}, Timestamp: ${new Date(timestamp * 1000).toISOString()}`);
  }
}

async function sendLockCommand(serialNumber, status) {
  return new Promise((resolve, reject) => {
    const action = status === 1 ? 'LOCK' : 'UNLOCK';
    const topic = `ekco/v1/${serialNumber}/lock/control`;
    const secondTopic = `ekco/${serialNumber}/custom/v1/lockControl`;
    const payload = `${status}`;

    console.log(`📡 [${new Date().toISOString()}] Backup: Establishing MQTT connection for ${action} command to ${serialNumber}`);

    const client = mqtt.connect("mqtt://ekco-tracking.co.za:1883", {
      username: "dev:ekcoFleets",
      password: "dzRND6ZqiI",
      reconnectPeriod: 0
    });

    let published = false;
    let publishCount = 0;
    const errors = [];
    const publishStartTime = Date.now();

    const publishCallback = (error, topicUsed) => {
      if (error) {
        errors.push(`${topicUsed}: ${error.message}`);
        console.error(`❌ [${new Date().toISOString()}] Backup: Failed to publish to topic ${topicUsed} for ${serialNumber}:`, error.message);
      } else {
        console.log(`✅ [${new Date().toISOString()}] Backup: Successfully published ${action} command to topic ${topicUsed} for ${serialNumber}`);
      }
      publishCount++;

      if (publishCount === 2 && !published) {
        published = true;
        const publishTime = Date.now() - publishStartTime;
        console.log(`📡 [${new Date().toISOString()}] Backup: MQTT publishing completed for ${serialNumber} in ${publishTime}ms`);

        client.end();

        if (errors.length > 0) {
          console.error(`❌ [${new Date().toISOString()}] Backup: MQTT publish errors for ${serialNumber}:`, errors);
          reject(new Error(`Failed to publish to MQTT topics: ${errors.join(', ')}`));
        } else {
          console.log(`✅ [${new Date().toISOString()}] Backup: All MQTT publications successful for ${serialNumber}`);

          // Update lock status in database
          pool.query(
            'INSERT INTO vehicle_lock_status (serial_number, status) VALUES ($1::text, $2) ON CONFLICT (serial_number) DO UPDATE SET status = EXCLUDED.status',
            [serialNumber, status]
          ).then(() => {
            console.log(`💾 [${new Date().toISOString()}] Backup: Lock status (${action}) persisted to database for ${serialNumber}`);
          }).catch(dbErr => {
            console.error(`❌ [${new Date().toISOString()}] Backup: Failed to persist lock status (${action}) for ${serialNumber}:`, dbErr);
          });

          resolve();
        }
      }
    };

    client.on('connect', () => {
      console.log(`🔗 [${new Date().toISOString()}] Backup: MQTT connected, publishing ${action} command to ${serialNumber}`);
      client.publish(topic, payload, { retain: false }, (error) => publishCallback(error, topic));
      client.publish(secondTopic, payload, { retain: false }, (error) => publishCallback(error, secondTopic));
    });

    client.on('error', (err) => {
      if (!published) {
        published = true;
        console.error(`❌ [${new Date().toISOString()}] Backup: MQTT connection error for ${serialNumber}:`, err);
        client.end();
        reject(err);
      }
    });

    // Timeout after 10 seconds
    setTimeout(() => {
      if (!published) {
        published = true;
        console.error(`⏰ [${new Date().toISOString()}] Backup: MQTT publish timeout for ${serialNumber} after 10 seconds`);
        client.end();
        reject(new Error('MQTT publish timeout'));
      }
    }, 10000);
  });
}

// Initialize database connection
pool.on('connect', () => {
  console.log(`🔄 [${new Date().toISOString()}] Backup: Connected to PostgreSQL database`);
});

pool.on('error', (err) => {
  console.error(`❌ [${new Date().toISOString()}] Backup: Unexpected error on database connection:`, err);
});

// Initialize MQTT connection
mqttClient.on('connect', () => {
  console.log(`📡 [${new Date().toISOString()}] Backup: MQTT connection established`);
});

mqttClient.on('error', (err) => {
  console.error(`❌ [${new Date().toISOString()}] Backup: MQTT connection error:`, err);
});

mqttClient.on('reconnect', () => {
  console.log(`🔄 [${new Date().toISOString()}] Backup: MQTT reconnecting...`);
});

mqttClient.on('offline', () => {
  console.warn(`⚠️ [${new Date().toISOString()}] Backup: MQTT connection offline`);
});

// Main monitoring loop
async function startMonitoring() {
  console.log(`🚀 [${new Date().toISOString()}] Backup: Starting PostGIS-based backup geofence lock monitoring...`);
  console.log(`📊 [${new Date().toISOString()}] Backup: Global geofence lock system: unlock inside ANY fence, lock outside ALL fences`);
  console.log(`⏱️ [${new Date().toISOString()}] Backup: Polling interval: ${POLL_INTERVAL}ms`);
  console.log(`🏢 [${new Date().toISOString()}] Backup: Restricted to company_id: e5a99ee4-4306-4065-bacd-876004cf1555`);

  // Start monitoring loop
  const intervalId = setInterval(async () => {
    try {
      await processGPSData();
    } catch (error) {
      console.error(`❌ [${new Date().toISOString()}] Backup: Error in monitoring loop:`, error);
    }
  }, POLL_INTERVAL);

  console.log(`🔄 [${new Date().toISOString()}] Backup: Monitoring loop started with interval ID: ${intervalId}`);

  // Initial run
  console.log(`🏁 [${new Date().toISOString()}] Backup: Performing initial GPS data processing...`);
  await processGPSData();
  console.log(`✅ [${new Date().toISOString()}] Backup: Initial processing completed`);
}

// Graceful shutdown
process.on('SIGINT', async () => {
  console.log(`🛑 [${new Date().toISOString()}] Backup: Received SIGINT, initiating graceful shutdown...`);

  try {
    console.log(`🔄 [${new Date().toISOString()}] Backup: Closing database connections...`);
    await pool.end();
    console.log(`✅ [${new Date().toISOString()}] Backup: Database connections closed successfully`);
  } catch (err) {
    console.error(`❌ [${new Date().toISOString()}] Backup: Error closing database connections:`, err.message);
  }

  console.log(`🔄 [${new Date().toISOString()}] Backup: Closing MQTT connection...`);
  mqttClient.end(() => {
    console.log(`✅ [${new Date().toISOString()}] Backup: MQTT connection closed, shutdown complete`);
    process.exit(0);
  });
});

process.on('SIGTERM', async () => {
  console.log(`🛑 [${new Date().toISOString()}] Backup: Received SIGTERM, shutting down gracefully...`);
  process.emit('SIGINT');
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error(`💥 [${new Date().toISOString()}] Backup: Uncaught Exception:`, error);
  console.error(`📊 [${new Date().toISOString()}] Backup: Stack trace:`, error.stack);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`💥 [${new Date().toISOString()}] Backup: Unhandled Rejection at:`, promise, 'reason:', reason);
  process.exit(1);
});

// Start the backup monitoring
console.log(`🚀 [${new Date().toISOString()}] Backup: Initializing backup geofence lock system...`);
startMonitoring().catch(error => {
  console.error(`❌ [${new Date().toISOString()}] Backup: Failed to start backup monitoring:`, error);
  process.exit(1);
});