# NexLock Backup Geofence Lock System

This backup system provides automatic lock/unlock commands for trucks based on geofence entry/exit events using PostGIS spatial queries. It serves as a defense mechanism against MQTT failures in the main system.

## How It Works

1. **Real-time GPS Monitoring**: Polls the `gps_ts` table for recent truck positions
2. **Spatial Analysis**: Uses PostGIS to determine if trucks are inside configured geofences
3. **State Tracking**: Maintains in-memory state of truck-geofence relationships
4. **Event Detection**: Detects entry/exit events by comparing current vs previous states
5. **Command Execution**: Sends MQTT lock/unlock commands independently of the main system

## Files

- `backup_geofence_lock.js` - Main backup script
- `backup_config.js` - Configuration file for lock rules
- `BACKUP_README.md` - This documentation

## Setup

### 1. Configure Lock Rules

Edit `backup_config.js` to define which geofences should trigger automatic lock/unlock commands:

```javascript
LOCK_RULES: {
  // Geofence ID: { enter: action, exit: action }
  1: { enter: 'lock', exit: 'unlock' },   // Lock on entry, unlock on exit
  2: { enter: 'unlock', exit: 'lock' },  // Unlock on entry, lock on exit
  3: { enter: 'lock', exit: null },      // Lock on entry only
  4: { exit: 'unlock', enter: null },    // Unlock on exit only
}
```

### 2. Find Geofence IDs

Get the IDs of your geofences from the database:

```sql
SELECT id, name FROM geofences WHERE active = true ORDER BY id;
```

### 3. Assign Trucks to Geofences

Ensure trucks are assigned to the geofences in your lock rules:

```sql
-- Check current truck assignments
SELECT id, name, trucks FROM geofences WHERE id IN (1, 2, 3, 4);

-- Update truck assignments if needed
UPDATE geofences SET trucks = ARRAY[123, 456] WHERE id = 1;
```

## Running the Backup System

### Development Mode (with auto-restart)
```bash
npm run backup:dev
```

### Production Mode
```bash
npm run backup
```

### Using PM2 (recommended for production)
```bash
# Install PM2 globally if not already installed
npm install -g pm2

# Start the backup system
pm2 start backup_geofence_lock.js --name backup-geofence-lock

# Monitor status
pm2 status

# View logs
pm2 logs backup-geofence-lock

# Restart if needed
pm2 restart backup-geofence-lock

# Stop the backup system
pm2 stop backup-geofence-lock
```

## Configuration Options

### Lock Rules

Each geofence can have different behaviors:

- `{ enter: 'lock', exit: 'unlock' }` - Lock when entering, unlock when exiting
- `{ enter: 'unlock', exit: 'lock' }` - Unlock when entering, lock when exiting
- `{ enter: 'lock', exit: null }` - Lock on entry only
- `{ exit: 'unlock', enter: null }` - Unlock on exit only

### Polling Interval

Adjust `POLL_INTERVAL` in `backup_config.js`:
- Lower values (2000-3000ms) = More responsive but higher database load
- Higher values (5000-10000ms) = Less responsive but lower database load

## Monitoring

The backup system logs all activities:

```
🔄 Backup script connected to PostgreSQL database
📡 Backup script MQTT connected
🚀 Starting PostGIS-based backup geofence lock monitoring...
📊 Lock rules configured for 2 geofence(s)
⏱️  Polling interval: 3000ms
🔒 Backup: LOCK truck 123 due to entering geofence Warehouse A
🔒 Backup: UNLOCK truck 456 due to exiting geofence Depot B
```

## Safety Features

1. **Independent Operation**: Works even if main system fails
2. **State Persistence**: Tracks truck-geofence states in memory
3. **Database Updates**: Updates `vehicle_lock_status` table
4. **Event Logging**: Records events in `geofence_alert_ts` table with "(BACKUP)" suffix
5. **Graceful Shutdown**: Proper cleanup on termination
6. **Error Handling**: Comprehensive error handling and recovery

## Troubleshooting

### No Lock Commands Being Sent

1. Check that `LOCK_RULES` is configured in `backup_config.js`
2. Verify geofence IDs match your database
3. Ensure trucks are assigned to geofences (`trucks` array)
4. Check that geofences are active (`active = true`)

### Database Connection Issues

1. Verify environment variables are set:
   - `DB_HOST`
   - `DB_PORT`
   - `DB_NAME`
   - `DB_USER`
   - `DB_PASSWORD`

2. Check database connectivity:
   ```bash
   psql -h $DB_HOST -p $DB_PORT -d $DB_NAME -U $DB_USER
   ```

### MQTT Connection Issues

1. Verify MQTT credentials in the script match your setup
2. Check network connectivity to MQTT broker
3. Monitor MQTT logs for connection errors

### Performance Issues

1. Increase `POLL_INTERVAL` if database load is too high
2. Monitor PostgreSQL performance with spatial queries
3. Consider adding database indexes on frequently queried columns

## Integration with Main System

The backup system:
- ✅ Sends the same MQTT commands as the main system
- ✅ Updates the same `vehicle_lock_status` table
- ✅ Logs events to `geofence_alert_ts` with "(BACKUP)" indicator
- ✅ Works alongside the main system without conflicts

Both systems can run simultaneously - the backup provides redundancy without interfering with normal operations.