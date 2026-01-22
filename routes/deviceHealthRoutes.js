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




// Device Health routes
router.get('/device-health', authenticateRequest, deviceHealthController.getDeviceHealth);
router.get('/motor-health', authenticateRequest, deviceHealthController.getMotorHealth);

// GPS routes
router.get('/gps', authenticateRequest,deviceHealthController.getAllGpsData);
router.get('/gps/latest', authenticateRequest, deviceHealthController.getLatestGpsData);
router.get('/gps/:device_serial',authenticateRequest, deviceHealthController.getGpsDataBySerial);
router.get('/gps/coordinates/:device_serial', authenticateRequest, deviceHealthController.getGpsCoordinates);
router.get('/gps/trip/:device_serial', authenticateRequest, deviceHealthController.getTripData);

// Alerts routes
router.get('/alerts', authenticateRequest, deviceHealthController.getAllAlerts);
router.get('/alerts/latest', authenticateRequest, deviceHealthController.getLatestAlerts);
router.get('/alerts/latest200', authenticateRequest, deviceHealthController.getLatest200Alerts);
router.get('/alerts/top200', authenticateRequest, deviceHealthController.getTop200AlertsPerDevice);
router.get('/alerts/:device_serial', authenticateRequest, deviceHealthController.getAlertsBySerial);

// Ignition routes
router.get('/ignition/:device_serial', authenticateRequest, deviceHealthController.getIgnitionStatus);

// Vehicle routes
router.get('/vehicles/vehicle/:device_serial', authenticateRequest, deviceHealthController.getVehicleInfo);

// Lock control routes
router.post('/locks/enable-auto-lock/:device_serial', authenticateRequest, deviceHealthController.enableAutoLock);
router.post('/locks/disable-auto-lock/:device_serial', authenticateRequest, deviceHealthController.disableAutoLock);

// Device reset routes
router.post('/device/reset/:device_serial', authenticateRequest, deviceHealthController.resetDevice);
module.exports = router;