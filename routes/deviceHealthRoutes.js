const express = require('express');
const router = express.Router();
const deviceHealthController = require('../controllers/deviceHealthController');


function authenticateRequest(req, res, next) {
  try {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: 'Authentication token missing' });
    }

    jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
      if (err) {
        return res.status(401).json({ error: 'Invalid or expired token' });
      }

      req.user = decoded;
      console.log('Authenticated user:', req.user);
      console.log('token:', token);
      next();
    });
  } catch (err) {
    console.error('Auth middleware error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}


router.use(authenticateRequest);

// Device Health routes
router.get('/device-health', deviceHealthController.getDeviceHealth);
router.get('/motor-health', deviceHealthController.getMotorHealth);

// GPS routes
router.get('/gps', deviceHealthController.getAllGpsData);
router.get('/gps/latest', deviceHealthController.getLatestGpsData);
router.get('/gps/:device_serial', deviceHealthController.getGpsDataBySerial);
router.get('/gps/coordinates/:device_serial', deviceHealthController.getGpsCoordinates);
router.get('/gps/trip/:device_serial', deviceHealthController.getTripData);

// Alerts routes
router.get('/alerts', deviceHealthController.getAllAlerts);
router.get('/alerts/latest', deviceHealthController.getLatestAlerts);
router.get('/alerts/latest200', deviceHealthController.getLatest200Alerts);
router.get('/alerts/top200', deviceHealthController.getTop200AlertsPerDevice);
router.get('/alerts/:device_serial', deviceHealthController.getAlertsBySerial);

// Ignition routes
router.get('/ignition/:device_serial', deviceHealthController.getIgnitionStatus);

// Vehicle routes
router.get('/vehicles/vehicle/:device_serial', deviceHealthController.getVehicleInfo);

// Lock control routes
router.post('/locks/enable-auto-lock/:device_serial', deviceHealthController.enableAutoLock);
router.post('/locks/disable-auto-lock/:device_serial', deviceHealthController.disableAutoLock);

// Device reset routes
router.post('/device/reset/:device_serial', deviceHealthController.resetDevice);

module.exports = router;