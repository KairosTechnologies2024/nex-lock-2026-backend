const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth/nex super users/nex_auth_supers_controller');
const controllerController = require('../controllers/auth/nex controllers/nex_auth_contollers_controller');
const globalAuthController = require('../controllers/auth/global auth/global_auth');

// Global login route
router.post('/nex-auth/login', globalAuthController.login);

// Customer routes
router.post('/nex-customers', authController.createCustomer);
router.get('/nex-customers', authController.getCustomers);
router.get('/nex-customers/:id', authController.getCustomerById);
router.put('/nex-customers/:id', authController.updateCustomer);
router.delete('/nex-customers/:id', authController.deleteCustomer);

// Controller routes
router.post('/nex-controllers', controllerController.createController);
router.get('/nex-controllers', controllerController.getControllers);
router.get('/nex-controllers/:id', controllerController.getControllerById);
router.put('/nex-controllers/:id', controllerController.updateController);
router.delete('/nex-controllers/:id', controllerController.deleteController);

module.exports = router;
