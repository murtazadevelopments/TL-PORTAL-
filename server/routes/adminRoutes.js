const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const requireAdmin = require('../middleware/requireAdmin');
const {
  listEmployees,
  getEmployeeById,
  updateEmployee,
} = require('../controllers/adminController');

const router = express.Router();

// All admin routes require a valid JWT + admin role
router.use(authMiddleware, requireAdmin);

// Employee directory + detail (reuse this pattern later for sales / projects modules)
router.get('/employees', listEmployees);
router.get('/employees/:id', getEmployeeById);
router.put('/employees/:id', updateEmployee);

module.exports = router;
