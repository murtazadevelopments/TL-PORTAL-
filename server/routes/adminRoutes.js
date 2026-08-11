const express = require('express');
const authMiddleware = require('../middleware/authMiddleware');
const requireAdmin = require('../middleware/requireAdmin');
const {
  listEmployees,
  getEmployeeById,
  updateEmployee,
  deleteEmployee,
} = require('../controllers/adminController');

const router = express.Router();

router.use(authMiddleware, requireAdmin);

router.get('/employees', listEmployees);
router.get('/employees/:id', getEmployeeById);
router.put('/employees/:id', updateEmployee);
router.delete('/employees/:id', deleteEmployee);

module.exports = router;
