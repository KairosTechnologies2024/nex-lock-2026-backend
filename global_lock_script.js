require('dotenv').config();

const { Pool } = require('pg');
const mqtt = require('mqtt');

// Validate environment variables
const requiredEnvVars = [
  'DB_HOST', 'DB_PORT', 'DB_NAME', 
  'DB_USER', 'DB_PASSWORD',
  'MQTT_URL', 'MQTT_USERNAME', 'MQTT_PASSWORD'
];

const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);
if (missingVars.length > 0) {
  console.error(`❌ Missing required environment variables: ${missingVars.join(', ')}`);
  process.exit(1);
}

// Configuration
const config = {
  POLL_INTERVAL: parseInt(process.env.POLL_INTERVAL || '30000'),
  COMPANY_ID: process.env.COMPANY_ID || 'e5a99ee4-4306-4065-bacd-876004cf1555',
  MAX_PROCESSING_TIME: 25000 // 25 seconds max per cycle
};

if (config.POLL_INTERVAL < 1000) {
  console.error(`❌ Invalid POLL_INTERVAL: ${config.POLL_INTERVAL}. Must be at least 1000ms`);
  process.exit(1);
}

// Database pool with optimized settings
const pool = new Pool({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  
  // Connection pool settings
  max: 20,                    // Increased for concurrent queries
  min: 2,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
  
  // Query timeouts
  query_timeout: 15000,       // 15 seconds
  statement_timeout: 15000,
  
  ssl: process.env.DB_SSL === 'true' || false,
  
  // Performance tuning
  application_name: 'geofence_backup_monitor',
  
  // Keep connections warm
  keepAlive: true,
  maxUses: 7500, // Close and reopen connections periodically
});

// MQTT Client (single connection reused)
const mqttClient = mqtt.connect(process.env.MQTT_URL, {
  username: process.env.MQTT_USERNAME,
  password: process.env.MQTT_PASSWORD,
  clientId: `geofence_backup_${Date.now()}`,
  clean: true,
  reconnectPeriod: 5000,
  connectTimeout: 10000,
  keepalive: 30,
  queueQoSZero: false, // Don't queue QoS 0 messages when offline
});

// State management
let lastProcessedTimestamp = Math.floor(Date.now() / 1000) - 60;
let isProcessing = false;
const truckGeofenceStates = new Map();
const metrics = {
  totalVehiclesProcessed: 0,
  totalGeofenceEvents: 0,
  totalLockCommands: 0,
  totalErrors: 0,
  processingTimes: [],
  dbQueryTimes: [],
  mqttPublishTimes: [],
  
  // Reset daily
  resetDaily: function() {
    this.totalVehiclesProcessed = 0;
    this.totalGeofenceEvents = 0;
    this.totalLockCommands = 0;
    this.totalErrors = 0;
    this.processingTimes = [];
    this.dbQueryTimes = [];
    this.mqttPublishTimes = [];
  }
};

// Helper: Calculate average
function calculateAverage(arr) {
  if (arr.length === 0) return 0;
  const sum = arr.reduce((a, b) => a + b, 0);
  return sum / arr.length;
}

// Log metrics periodically
setInterval(() => {
  const avgProcessingTime = calculateAverage(metrics.processingTimes);
  const avgDbQueryTime = calculateAverage(metrics.dbQueryTimes);
  const avgMqttPublishTime = calculateAverage(metrics.mqttPublishTimes);
  
  console.log(`📊 [${new Date().toISOString()}] Backup: Performance Metrics -`, {
    vehiclesProcessed: metrics.totalVehiclesProcessed,
    geofenceEvents: metrics.totalGeofenceEvents,
    lockCommands: metrics.totalLockCommands,
    errors: metrics.totalErrors,
    avgProcessingTime: `${avgProcessingTime.toFixed(2)}ms`,
    avgDbQueryTime: `${avgDbQueryTime.toFixed(2)}ms`,
    avgMqttPublishTime: `${avgMqttPublishTime.toFixed(2)}ms`,
    activeTrucks: truckGeofenceStates.size,
    memoryUsage: `${(process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2)}MB`
  });
}, 300000); // Every 5 minutes

// Reset metrics daily at midnight
setInterval(() => {
  console.log(`🔄 [${new Date().toISOString()}] Backup: Resetting daily metrics`);
  metrics.resetDaily();
}, 24 * 60 * 60 * 1000);

// Database connection health check
async function checkDatabaseConnection() {
  const startTime = Date.now();
  try {
    await pool.query('SELECT 1');
    const queryTime = Date.now() - startTime;
    if (queryTime > 1000) {
      console.warn(`⚠️ [${new Date().toISOString()}] Backup: Slow database response: ${queryTime}ms`);
    }
    return true;
  } catch (error) {
    console.error(`❌ [${new Date().toISOString()}] Backup: Database health check failed:`, error.message);
    return false;
  }
}

// Optimized GPS data query with indexed geofence check
async function processGPSData() {
  if (isProcessing) {
    console.log(`⏳ [${new Date().toISOString()}] Backup: Skipping, previous run still in progress`);
    return;
  }
  
  const startTime = Date.now();
  isProcessing = true;
  
  try {
    // Check database connection first
    const dbHealthy = await checkDatabaseConnection();
    if (!dbHealthy) {
      console.error(`❌ [${new Date().toISOString()}] Backup: Database unhealthy, skipping cycle`);
      return;
    }
    
    console.log(`🔍 [${new Date().toISOString()}] Backup: Starting GPS data processing from timestamp ${lastProcessedTimestamp}`);
    
    // OPTIMIZED: Get latest position per vehicle with window function
    const gpsQuery = `
      WITH latest_vehicle_positions AS (
        SELECT DISTINCT ON (g.device_serial)
          g.device_serial,
          ST_X(g.location::geometry) as longitude,
          ST_Y(g.location::geometry) as latitude,
          g.time,
          g.speed,
          v.company_id,
          v.registration_number,
          ROW_NUMBER() OVER (PARTITION BY g.device_serial ORDER BY g.time DESC) as rn
        FROM gps_ts g
        INNER JOIN vehicle_info v ON g.device_serial::text = v.device_serial::text
        WHERE g.time > $1::bigint
          AND v.company_id = $2
          AND v.active = true
        ORDER BY g.device_serial, g.time DESC
      )
      SELECT 
        device_serial,
        longitude,
        latitude,
        time,
        speed,
        registration_number
      FROM latest_vehicle_positions
      WHERE rn = 1
      ORDER BY time DESC
      LIMIT 500 -- Safety limit
    `;
    
    const queryStartTime = Date.now();
    const gpsResult = await pool.query(gpsQuery, [lastProcessedTimestamp, config.COMPANY_ID]);
    const queryTime = Date.now() - queryStartTime;
    metrics.dbQueryTimes.push(queryTime);
    
    console.log(`📊 [${new Date().toISOString()}] Backup: Found ${gpsResult.rows.length} vehicles, query took ${queryTime}ms`);
    
    if (gpsResult.rows.length === 0) {
      console.log(`ℹ️ [${new Date().toISOString()}] Backup: No new GPS data to process`);
      return;
    }
    
    // Update timestamp for next run (use max time from results)
    const maxTimestamp = Math.max(...gpsResult.rows.map(r => parseInt(r.time)));
    if (maxTimestamp > lastProcessedTimestamp) {
      lastProcessedTimestamp = maxTimestamp;
    }
    
    console.log(`🚛 [${new Date().toISOString()}] Backup: Processing ${gpsResult.rows.length} vehicles`);
    
    // Process vehicles in batches for better performance
    const batchSize = 10;
    let processedCount = 0;
    
    for (let i = 0; i < gpsResult.rows.length; i += batchSize) {
      const batch = gpsResult.rows.slice(i, i + batchSize);
      const batchPromises = batch.map(row => 
        checkGeofenceStatus(row.device_serial, row)
      );
      
      await Promise.allSettled(batchPromises);
      processedCount += batch.length;
      
      // Log progress for large batches
      if (gpsResult.rows.length > 50) {
        console.log(`📈 [${new Date().toISOString()}] Backup: Processed ${processedCount}/${gpsResult.rows.length} vehicles`);
      }
    }
    
    metrics.totalVehiclesProcessed += processedCount;
    
    const processingTime = Date.now() - startTime;
    metrics.processingTimes.push(processingTime);
    
    // Warn if processing is taking too long
    if (processingTime > config.MAX_PROCESSING_TIME) {
      console.warn(`⚠️ [${new Date().toISOString()}] Backup: Processing took ${processingTime}ms (>${config.MAX_PROCESSING_TIME}ms limit)`);
    }
    
    console.log(`✅ [${new Date().toISOString()}] Backup: Completed processing ${processedCount} vehicles in ${processingTime}ms`);
    
  } catch (error) {
    console.error(`❌ [${new Date().toISOString()}] Backup: Error processing GPS data:`, error);
    metrics.totalErrors++;
  } finally {
    isProcessing = false;
  }
}

// OPTIMIZED: Geofence check with indexed polygon geometry
async function checkGeofenceStatus(deviceSerial, gpsData) {
  const checkStartTime = Date.now();
  
  try {
    const { longitude, latitude, time, registration_number, speed } = gpsData;
    
    // OPTIMIZED: Single query with spatial index usage
    const geofenceQuery = `
      WITH vehicle_point AS (
        SELECT ST_SetSRID(ST_MakePoint($1, $2), 4326) as point
      ),
      relevant_geofences AS (
        SELECT 
          g.id,
          g.name,
          g.shape,
          g.radius_km,
          g.centre_point,
          g.polygon_geometry,
          -- Fast bounding box pre-filter using index
          CASE 
            WHEN g.shape = 'circle' THEN
              g.centre_point::geography && ST_Buffer(vp.point::geography, COALESCE(g.radius_km, 10) * 1000)
            WHEN g.shape = 'polygon' THEN
              g.polygon_geometry && vp.point
            ELSE false
          END as bbox_intersects
        FROM geofences g
        CROSS JOIN vehicle_point vp
        WHERE g.active = true
          -- Optional: Add company-specific geofences if needed
          -- AND (g.company_id IS NULL OR g.company_id = $3)
      )
      SELECT 
        id,
        name,
        shape,
        radius_km,
        CASE
          WHEN shape = 'circle' THEN
            ST_DWithin(centre_point, vp.point::geography, radius_km * 1000)
          WHEN shape = 'polygon' AND polygon_geometry IS NOT NULL THEN
            ST_Contains(polygon_geometry, vp.point)
          ELSE false
        END as inside_geofence
      FROM relevant_geofences rg
      CROSS JOIN vehicle_point vp
      WHERE bbox_intersects = true
    `;
    
    const queryStartTime = Date.now();
    const geofenceResult = await pool.query(geofenceQuery, [longitude, latitude]);
    const queryTime = Date.now() - queryStartTime;
    
    const isInsideAnyFence = geofenceResult.rows.some(geofence => geofence.inside_geofence);
    const wasInsideAnyFence = truckGeofenceStates.get(deviceSerial) || false;
    
    // Log detailed geofence info only on change or debug mode
    if (isInsideAnyFence !== wasInsideAnyFence || process.env.DEBUG_MODE === 'true') {
      const insideFences = geofenceResult.rows
        .filter(g => g.inside_geofence)
        .map(g => `${g.name} (${g.shape})`);
      
      console.log(`📍 [${new Date().toISOString()}] Backup: ${deviceSerial} (${registration_number}) - ` +
        `Inside: [${insideFences.join(', ')}], Position: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
    }
    
    if (wasInsideAnyFence !== isInsideAnyFence) {
      const statusChange = wasInsideAnyFence ? 'EXITED' : 'ENTERED';
      console.log(`⚡ [${new Date().toISOString()}] Backup: STATUS CHANGE - ${deviceSerial} (${registration_number}) ${statusChange} geofence zone`);
      
      metrics.totalGeofenceEvents++;
      await handleGlobalGeofenceEvent(deviceSerial, isInsideAnyFence, time, registration_number);
      truckGeofenceStates.set(deviceSerial, isInsideAnyFence);
    }
    
    const checkTime = Date.now() - checkStartTime;
    if (checkTime > 1000) {
      console.warn(`⚠️ [${new Date().toISOString()}] Backup: Slow geofence check for ${deviceSerial}: ${checkTime}ms`);
    }
    
  } catch (error) {
    console.error(`❌ [${new Date().toISOString()}] Backup: Error checking geofence status for ${deviceSerial}:`, error);
    metrics.totalErrors++;
  }
}

// Handle geofence events with retry logic
async function handleGlobalGeofenceEvent(deviceSerial, isInsideAnyFence, timestamp, registrationNumber) {
  const eventStartTime = Date.now();
  
  const shouldLock = !isInsideAnyFence; // lock when outside all fences
  const action = shouldLock ? 'lock' : 'unlock';
  const eventType = isInsideAnyFence ? 'entering fence zone' : 'exiting all fence zones';
  
  console.log(`🚨 [${new Date().toISOString()}] Backup: GLOBAL GEOFENCE EVENT - ${deviceSerial} (${registrationNumber}) ${eventType.toUpperCase()}`);
  
  try {
    // Send lock command with retry logic
    const commandStartTime = Date.now();
    await sendLockCommandWithRetry(deviceSerial, shouldLock ? 1 : 0, registrationNumber);
    const commandTime = Date.now() - commandStartTime;
    metrics.mqttPublishTimes.push(commandTime);
    
    metrics.totalLockCommands++;
    
    console.log(`✅ [${new Date().toISOString()}] Backup: ${action.toUpperCase()} command sent to ${deviceSerial} in ${commandTime}ms`);
    
    // Log to database
    await pool.query(`
      INSERT INTO geofence_alert_ts (time, geofence_id, device_serial, alert)
      VALUES ($1, $2, $3::bigint, $4)
      ON CONFLICT DO NOTHING
    `, [timestamp, null, deviceSerial, 
        `${isInsideAnyFence ? 'INSIDE' : 'OUTSIDE'}_GEOFENCE - ${registrationNumber}`]);
    
    // Also update vehicle status
    await pool.query(`
      INSERT INTO vehicle_lock_status (serial_number, status, last_updated, triggered_by)
      VALUES ($1::text, $2, $3, 'geofence_backup')
      ON CONFLICT (serial_number) 
      DO UPDATE SET 
        status = EXCLUDED.status,
        last_updated = EXCLUDED.last_updated,
        triggered_by = EXCLUDED.triggered_by
    `, [deviceSerial, shouldLock ? 1 : 0, new Date()]);
    
    const totalEventTime = Date.now() - eventStartTime;
    console.log(`🏁 [${new Date().toISOString()}] Backup: Event handling completed for ${deviceSerial} in ${totalEventTime}ms`);
    
  } catch (error) {
    console.error(`❌ [${new Date().toISOString()}] Backup: Failed to handle geofence event for ${deviceSerial}:`, error.message);
    metrics.totalErrors++;
  }
}

// Improved MQTT send with retry logic
async function sendLockCommandWithRetry(serialNumber, status, registrationNumber, retryCount = 0) {
  const maxRetries = 3;
  const retryDelay = 1000; // 1 second
  
  try {
    await sendLockCommand(serialNumber, status, registrationNumber);
  } catch (error) {
    if (retryCount < maxRetries) {
      console.log(`🔄 [${new Date().toISOString()}] Backup: Retry ${retryCount + 1}/${maxRetries} for ${serialNumber}`);
      await new Promise(resolve => setTimeout(resolve, retryDelay * (retryCount + 1)));
      return sendLockCommandWithRetry(serialNumber, status, registrationNumber, retryCount + 1);
    } else {
      throw new Error(`Failed after ${maxRetries} retries: ${error.message}`);
    }
  }
}

// Send lock command using shared MQTT connection
async function sendLockCommand(serialNumber, status, registrationNumber) {
  return new Promise((resolve, reject) => {
    if (!mqttClient.connected) {
      return reject(new Error('MQTT client not connected'));
    }
    
    const action = status === 1 ? 'LOCK' : 'UNLOCK';
    const topic = `ekco/v1/${serialNumber}/lock/control`;
    const secondTopic = `ekco/${serialNumber}/custom/v1/lockControl`;
    const payload = `${status}`;
    
    let publishCount = 0;
    const errors = [];
    const publishStartTime = Date.now();
    
    const publishCallback = (error, topicUsed) => {
      if (error) {
        errors.push(`${topicUsed}: ${error.message}`);
        console.error(`❌ [${new Date().toISOString()}] Backup: Failed to publish to ${topicUsed} for ${serialNumber}`);
      }
      publishCount++;
      
      if (publishCount === 2) {
        const publishTime = Date.now() - publishStartTime;
        
        if (errors.length > 0) {
          reject(new Error(`MQTT publish failed: ${errors.join(', ')}`));
        } else {
          console.log(`📡 [${new Date().toISOString()}] Backup: ${action} command published to ${serialNumber} in ${publishTime}ms`);
          resolve();
        }
      }
    };
    
    // Publish with QoS 1 for guaranteed delivery
    mqttClient.publish(topic, payload, { qos: 1, retain: false }, (error) => publishCallback(error, topic));
    mqttClient.publish(secondTopic, payload, { qos: 1, retain: false }, (error) => publishCallback(error, secondTopic));
    
    // Timeout after 5 seconds
    setTimeout(() => {
      if (publishCount < 2) {
        reject(new Error('MQTT publish timeout'));
      }
    }, 5000);
  });
}

// Database migration helper (run once)
async function setupDatabaseOptimizations() {
  try {
    console.log(`🛠️ [${new Date().toISOString()}] Backup: Checking database optimizations...`);
    
    // Check if polygon_geometry column exists
    const checkColumn = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'geofences' 
        AND column_name = 'polygon_geometry'
    `);
    
    if (checkColumn.rows.length === 0) {
      console.log(`🛠️ [${new Date().toISOString()}] Backup: Adding polygon_geometry column...`);
      
      await pool.query(`
        ALTER TABLE geofences 
        ADD COLUMN IF NOT EXISTS polygon_geometry geometry(Polygon, 4326)
      `);
      
      console.log(`🛠️ [${new Date().toISOString()}] Backup: Populating polygon_geometry column...`);
      
      await pool.query(`
        UPDATE geofences 
        SET polygon_geometry = ST_MakePolygon(ST_MakeLine(
          ARRAY(
            SELECT ST_MakePoint(
              COALESCE(
                (elem->>'lng')::float,
                (elem->>'lon')::float,
                (elem->>'x')::float,
                0
              ),
              COALESCE(
                (elem->>'lat')::float,
                (elem->>'latitude')::float,
                (elem->>'y')::float,
                0
              )
            )
            FROM jsonb_array_elements(polygon_coords) AS elem
            WHERE polygon_coords IS NOT NULL
          )
        ))
        WHERE shape = 'polygon' 
          AND polygon_coords IS NOT NULL
          AND jsonb_array_length(polygon_coords) >= 3
          AND polygon_geometry IS NULL
      `);
      
      console.log(`🛠️ [${new Date().toISOString()}] Backup: Creating spatial index...`);
      
      await pool.query(`
        CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_geofences_polygon_geom 
        ON geofences USING GIST(polygon_geometry)
        WHERE shape = 'polygon'
      `);
      
      console.log(`✅ [${new Date().toISOString()}] Backup: Database optimizations completed`);
    } else {
      console.log(`✅ [${new Date().toISOString()}] Backup: Database optimizations already in place`);
    }
  } catch (error) {
    console.error(`❌ [${new Date().toISOString()}] Backup: Database optimization failed:`, error);
  }
}

// Initialize connections
pool.on('connect', () => {
  console.log(`🔄 [${new Date().toISOString()}] Backup: Connected to PostgreSQL database`);
});

pool.on('error', (err) => {
  console.error(`❌ [${new Date().toISOString()}] Backup: Database pool error:`, err);
});

// MQTT event handlers
mqttClient.on('connect', () => {
  console.log(`📡 [${new Date().toISOString()}] Backup: MQTT connection established`);
});

mqttClient.on('error', (err) => {
  console.error(`❌ [${new Date().toISOString()}] Backup: MQTT error:`, err);
});

mqttClient.on('offline', () => {
  console.warn(`⚠️ [${new Date().toISOString()}] Backup: MQTT offline`);
});

mqttClient.on('reconnect', () => {
  console.log(`🔄 [${new Date().toISOString()}] Backup: MQTT reconnecting...`);
});

// Main monitoring loop
async function startMonitoring() {
  console.log(`🚀 [${new Date().toISOString()}] Backup: Starting optimized geofence monitoring...`);
  console.log(`📊 [${new Date().toISOString()}] Backup: Configuration -`, {
    pollInterval: `${config.POLL_INTERVAL}ms`,
    companyId: config.COMPANY_ID,
    maxProcessingTime: `${config.MAX_PROCESSING_TIME}ms`
  });
  
  // Setup database optimizations
  await setupDatabaseOptimizations();
  
  // Start health check monitoring
  setInterval(async () => {
    await checkDatabaseConnection();
  }, 60000);
  
  // Start monitoring loop with overlap protection
  const intervalId = setInterval(async () => {
    try {
      await processGPSData();
    } catch (error) {
      console.error(`❌ [${new Date().toISOString()}] Backup: Monitoring loop error:`, error);
      metrics.totalErrors++;
    }
  }, config.POLL_INTERVAL);
  
  console.log(`🔄 [${new Date().toISOString()}] Backup: Monitoring loop started (interval: ${config.POLL_INTERVAL}ms)`);
  
  // Initial run
  console.log(`🏁 [${new Date().toISOString()}] Backup: Performing initial processing...`);
  await processGPSData();
  console.log(`✅ [${new Date().toISOString()}] Backup: Initial processing completed`);
}

// Graceful shutdown
async function shutdown() {
  console.log(`🛑 [${new Date().toISOString()}] Backup: Initiating graceful shutdown...`);
  
  try {
    console.log(`🔄 [${new Date().toISOString()}] Backup: Closing database pool...`);
    await pool.end();
    console.log(`✅ [${new Date().toISOString()}] Backup: Database pool closed`);
  } catch (err) {
    console.error(`❌ [${new Date().toISOString()}] Backup: Error closing database:`, err.message);
  }
  
  console.log(`🔄 [${new Date().toISOString()}] Backup: Closing MQTT connection...`);
  mqttClient.end(() => {
    console.log(`✅ [${new Date().toISOString()}] Backup: MQTT connection closed`);
    console.log(`👋 [${new Date().toISOString()}] Backup: Shutdown complete`);
    process.exit(0);
  });
}

// Signal handlers
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Error handlers
process.on('uncaughtException', (error) => {
  console.error(`💥 [${new Date().toISOString()}] Backup: Uncaught Exception:`, error);
  console.error(`📊 [${new Date().toISOString()}] Backup: Stack:`, error.stack);
  
  // Attempt to log error to database before exit
  pool.query('SELECT 1').catch(() => {}).finally(() => {
    setTimeout(() => process.exit(1), 1000);
  });
});

process.on('unhandledRejection', (reason, promise) => {
  console.error(`💥 [${new Date().toISOString()}] Backup: Unhandled Rejection at:`, promise, 'reason:', reason);
  metrics.totalErrors++;
});

// Start the system
console.log(`🚀 [${new Date().toISOString()}] Backup: Initializing geofence monitoring system...`);
startMonitoring().catch(error => {
  console.error(`❌ [${new Date().toISOString()}] Backup: Failed to start monitoring:`, error);
  process.exit(1);
});