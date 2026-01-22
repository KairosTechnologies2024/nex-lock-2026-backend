

module.exports = {
 
  LOCK_RULES: {
    

    // 1: { enter: 'lock', exit: 'unlock' },     // Lock on entry, unlock on exit
    // 2: { enter: 'unlock', exit: 'lock' },     // Unlock on entry, lock on exit
    // 3: { enter: 'lock', exit: null },         // Lock on entry only
    // 4: { exit: 'unlock', enter: null },       // Unlock on exit only
    // 5: { enter: 'lock', exit: 'lock' },       // Always lock (entry and exit)
    // 6: { enter: 'unlock', exit: 'unlock' },   // Always unlock (entry and exit)

    // Add your geofence rules here:
    // Replace the numbers with actual geofence IDs from your database
    //
    // Example configurations (uncomment and modify):
    // 1: { enter: 'lock', exit: 'unlock' },     // Lock on entry, unlock on exit
    // 2: { enter: 'unlock', exit: 'lock' },     // Unlock on entry, lock on exit
  },

  // Monitoring settings
  POLL_INTERVAL: 5000, // Check GPS data every 3 seconds


  DATABASE_CONFIG: {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
  },

 
  MQTT_CONFIG: {
    host: "mqtt://ekco-tracking.co.za:1883",
    username: "dev:ekcoFleets",
    password: "dzRND6ZqiI"
  },

  // Logging settings
  LOG_LEVEL: 'info', 
  LOG_EVENTS: true, 
  LOG_COMMANDS: true, 
};


function validateConfig() {
  const errors = [];

  if (Object.keys(module.exports.LOCK_RULES).length === 0) {
    errors.push('No lock rules configured. Add rules to LOCK_RULES object.');
  }

  for (const [geofenceId, rules] of Object.entries(module.exports.LOCK_RULES)) {
    if (!rules.enter && !rules.exit) {
      errors.push(`Geofence ${geofenceId}: At least one of 'enter' or 'exit' must be defined.`);
    }

    if (rules.enter && !['lock', 'unlock'].includes(rules.enter)) {
      errors.push(`Geofence ${geofenceId}: 'enter' must be 'lock' or 'unlock', got '${rules.enter}'.`);
    }

    if (rules.exit && !['lock', 'unlock'].includes(rules.exit)) {
      errors.push(`Geofence ${geofenceId}: 'exit' must be 'lock' or 'unlock', got '${rules.exit}'.`);
    }
  }

  if (errors.length > 0) {
    console.error('❌ Configuration validation errors:');
    errors.forEach(error => console.error(`   ${error}`));
    process.exit(1);
  }
}


if (require.main === module) {
  validateConfig();
  console.log('✅ Backup configuration is valid');
  console.log(`📊 Lock rules configured for ${Object.keys(module.exports.LOCK_RULES).length} geofence(s)`);
}