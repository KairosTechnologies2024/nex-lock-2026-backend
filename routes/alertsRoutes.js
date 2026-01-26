const express = require('express');
const router = express.Router();
const authenticateRequest = require('../config/authenticateRequest');

// Create a factory function to inject the pool dependency
function createAlertsRoutes(pool) {
  // Alerts Lock Stats Endpoint
  router.get('/alerts/lock-stats', authenticateRequest, async (req, res) => {
    try {
      const userCompanyId = req.user.company_id;
      console.log("Fetching lock stats for company:", userCompanyId);
      
      const result = await pool.query(`
          SELECT
              a.time,
              a.device_serial,
              a.alert,
              COALESCE(vi.fleet_number, vi.vehicle_reg, 'Unknown Fleet') as fleet
          FROM alert_ts a
          INNER JOIN vehicle_info vi ON a.device_serial::text = vi.device_serial
          WHERE a.alert IN ('LOCKED', 'UNLOCKED', 'LOCK JAMMED !', 'LOCK JAM !')
            AND vi.nex_customer_id = $1
          ORDER BY a.time DESC
          LIMIT 2000
      `, [userCompanyId]);
      console.log('lock stats alerts for company:', userCompanyId, 'count:', result.rows.length)
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: "Database error", details: err.message });
    }
  });

  // Geofence Alerts Endpoint
  router.get('/geofence-alerts', authenticateRequest, async (req, res) => {
    try {
      const userCompanyId = req.user.company_id;

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
        INNER JOIN vehicle_info vi ON ga.device_serial::text = vi.device_serial AND vi.nex_customer_id = $1

        ORDER BY ga.time DESC
        LIMIT 1000
      `, [userCompanyId]);

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

  // Vehicle Alerts Endpoint
  router.get('/trucks/:device_serial/alerts', authenticateRequest, async (req, res) => {
    try {
      const { device_serial } = req.params;
      const { limit = 50 } = req.query;
      const userCompanyId = req.user.company_id;

      // Verify the vehicle exists and belongs to user's company
      const vehicleResult = await pool.query(
        'SELECT device_serial FROM vehicle_info WHERE device_serial = $1 AND nex_customer_id = $2',
        [device_serial, userCompanyId]
      );

      if (vehicleResult.rows.length === 0) {
        return res.status(404).json({ error: 'Vehicle not found or access denied' });
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

   // Latest 200 Alerts Endpoint (authenticated users only)
  router.get('/alerts/latest200', authenticateRequest, async (req, res) => {
    try {
      const userCompanyId = req.user.company_id;
      const result = await pool.query(`
          SELECT a.*
          FROM alert_ts a
          INNER JOIN vehicle_info vi ON a.device_serial::text = vi.device_serial
          WHERE vi.nex_customer_id = $1
          ORDER BY a.time DESC
          LIMIT 200
      `, [userCompanyId]);
      console.log('latest 200 alerts for company:', userCompanyId, 'count:', result.rows.length)
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: "Database error", details: err.message });
    }
  });

  // Latest Alerts Endpoint (authenticated users only)
  router.get('/alerts/latest', authenticateRequest, async (req, res) => {
    try {
      const userCompanyId = req.user.company_id;
      const result = await pool.query(`
          SELECT DISTINCT ON (a.device_serial) a.*
          FROM alert_ts a
          INNER JOIN vehicle_info vi ON a.device_serial::text = vi.device_serial
          WHERE vi.nex_customer_id = $1
          ORDER BY a.device_serial, a.time DESC
      `, [userCompanyId]);
      console.log('latest alerts for company:', userCompanyId, 'count:', result.rows.length)
      res.json(result.rows);
    } catch (err) {
      res.status(500).json({ error: "Database error", details: err.message });
    }
  });

  return router;
}

module.exports = createAlertsRoutes;
