// Load environment variables
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const port = process.env.PORT || 5000;

// Middleware
app.use(cors());
app.use(express.json());

// PostgreSQL Connection
const pool = new Pool({
  user: process.env.DB_USER || 'postgres',
  host: process.env.DB_HOST || 'localhost',
  database: process.env.DB_NAME || 'buidco_leave',
  password: process.env.DB_PASSWORD || 'sid91221',
  port: process.env.DB_PORT || 5432,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
  max: 20
});

// ===== BACKEND SAFEGUARDS =====

// Validation functions
const validateLeaveType = (type) => {
  const normalizedType = (type || '').toUpperCase().trim();
  return ['CL', 'RH', 'EL'].includes(normalizedType);
};

const validateLeaveBalance = (balance) => {
  return typeof balance === 'number' && balance >= 0 && balance <= 365; // Max 1 year
};

const normalizeLeaveBalance = (balance) => {
  if (balance === null || balance === undefined) return 0;
  const numBalance = parseInt(balance);
  return isNaN(numBalance) ? 0 : Math.max(0, numBalance);
};

const validateDateRange = (startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  return start >= today && end >= start;
};

const calculateLeaveDays = (startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  
  // Set time to midnight to avoid timezone issues
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  
  const days = Math.floor((end - start) / (1000 * 60 * 60 * 24)) + 1;
  return Math.max(1, days); // Minimum 1 day
};

const normalizeLeaveType = (type) => {
  const normalizedType = (type || '').toUpperCase().trim();
  if (['CL', 'RH', 'EL'].includes(normalizedType)) {
    return normalizedType;
  }
  return null;
};

const validateLeaveDays = (days, leaveType) => {
  if (typeof days !== 'number' || days < 1) {
    return false;
  }
  
  // Set reasonable limits for different leave types
  const maxDays = {
    'CL': 30, // Max 30 days for casual leave
    'RH': 15, // Max 15 days for restricted holiday
    'EL': 60  // Max 60 days for earned leave
  };
  
  return days <= maxDays[leaveType] || 30; // Default max 30 days
};

// Balance normalization function
const normalizeEmployeeBalances = async (employeeId) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    
    // Get current balances
    const result = await client.query(
      'SELECT cl_balance, rh_balance, el_balance FROM employees WHERE employee_id = $1',
      [employeeId]
    );
    
    if (result.rows.length === 0) {
      throw new Error('Employee not found');
    }
    
    const employee = result.rows[0];
    
    // Normalize balances with reasonable limits
    const normalizedBalances = {
      cl_balance: Math.min(30, normalizeLeaveBalance(employee.cl_balance)), // Max 30 CL
      rh_balance: Math.min(15, normalizeLeaveBalance(employee.rh_balance)), // Max 15 RH
      el_balance: Math.min(18, normalizeLeaveBalance(employee.el_balance))  // Max 18 EL
    };
    
    // Update with normalized values
    await client.query(
      `UPDATE employees 
       SET cl_balance = $1, rh_balance = $2, el_balance = $3 
       WHERE employee_id = $4`,
      [normalizedBalances.cl_balance, normalizedBalances.rh_balance, normalizedBalances.el_balance, employeeId]
    );
    
    await client.query('COMMIT');
    console.log(`Normalized balances for employee ${employeeId}:`, normalizedBalances);
    return normalizedBalances;
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Error normalizing balances:', err);
    throw err;
  } finally {
    client.release();
  }
};

// Data integrity check function
const checkDataIntegrity = async () => {
  try {
    // Check for negative balances
    const negativeBalances = await pool.query(`
      SELECT employee_id, full_name, cl_balance, rh_balance, el_balance 
      FROM employees 
      WHERE cl_balance < 0 OR rh_balance < 0 OR el_balance < 0
    `);
    
    if (negativeBalances.rows.length > 0) {
      console.warn('Found employees with negative balances:', negativeBalances.rows);
      
      // Fix negative balances
      for (const employee of negativeBalances.rows) {
        await normalizeEmployeeBalances(employee.employee_id);
      }
    }
    
    // Check for unreasonably high balances
    const highBalances = await pool.query(`
      SELECT employee_id, full_name, cl_balance, rh_balance, el_balance 
      FROM employees 
      WHERE cl_balance > 30 OR rh_balance > 15 OR el_balance > 30
    `);
    
    if (highBalances.rows.length > 0) {
      console.warn('Found employees with high balances:', highBalances.rows);
      
      // Normalize high balances
      for (const employee of highBalances.rows) {
        await normalizeEmployeeBalances(employee.employee_id);
      }
    }
    
    console.log('Data integrity check completed');
  } catch (err) {
    console.error('Error in data integrity check:', err);
  }
};

// Run data integrity check on startup
setTimeout(checkDataIntegrity, 5000); // Run after 5 seconds

// Test database connection
pool.query('SELECT NOW()', (err, res) => {
  if (err) {
    console.error('Error connecting to the database:', err);
    console.error('Database connection details:', {
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'buidco_leave',
      user: process.env.DB_USER || 'postgres'
    });
    console.error('Please check:');
    console.error('1. PostgreSQL service is running');
    console.error('2. Database credentials are correct');
    console.error('3. Database exists and is accessible');
    console.error('4. Firewall/network settings allow connection');
  } else {
    console.log('Connected to PostgreSQL database');
  }
});

// Multer config for leave documents
const leaveDocsStorage = multer.diskStorage({
  destination: function (req, file, cb) {
    const dir = path.join(__dirname, 'uploads', 'leave_docs');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});
const uploadLeaveDoc = multer({ storage: leaveDocsStorage });

// Create tables if they don't exist
async function createTables() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Check if tables exist first
    const tablesExist = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name IN ('employees', 'leaves')
      );
    `);

    if (!tablesExist.rows[0].exists) {
      console.log('Tables do not exist. Please create them manually with proper permissions.');
      return;
    }

    // Check if columns exist in employees table
    const columnsExist = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'employees'
        AND column_name IN ('cl_balance', 'rh_balance', 'el_balance')
      );
    `);

    if (!columnsExist.rows[0].exists) {
      console.log('Adding leave balance columns to employees table...');
      await client.query(`
        ALTER TABLE employees 
        ADD COLUMN IF NOT EXISTS cl_balance INTEGER DEFAULT 10,
        ADD COLUMN IF NOT EXISTS rh_balance INTEGER DEFAULT 5,
        ADD COLUMN IF NOT EXISTS el_balance INTEGER DEFAULT 18;
      `);
      console.log('Columns added successfully');
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === '42501') { // Permission denied error
      console.log('Permission denied. Using existing tables...');
    } else {
      console.error('Error checking/creating tables:', err);
    }
  } finally {
    client.release();
  }
}

// Call the function to create tables
createTables();

// Add balance columns if they don't exist
const addBalanceColumns = async () => {
  try {
    await pool.query(`
      DO $$ 
      BEGIN 
        -- Add designation column to leaves table if it doesn't exist
        IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='leaves' AND column_name='designation') THEN
          ALTER TABLE leaves ADD COLUMN designation VARCHAR(255);
        END IF;

        -- Update existing leaves with designation from employees
        UPDATE leaves l 
        SET designation = e.designation 
        FROM employees e 
        WHERE l.employee_id = e.employee_id 
        AND l.designation IS NULL;
      END $$;
    `);
    console.log('Columns added successfully');
  } catch (err) {
    console.error('Error adding columns:', err);
  }
};

// Call the function to add balance columns
addBalanceColumns();

// Ensure cancel_request_status and cancel_reason columns exist
(async () => {
  try {
    await pool.query(`
      ALTER TABLE leaves
      ADD COLUMN IF NOT EXISTS cancel_request_status VARCHAR(20),
      ADD COLUMN IF NOT EXISTS cancel_reason TEXT;
    `);
    // Create notifications table if not exists
    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        type VARCHAR(50),
        message TEXT,
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        user_id INTEGER
      );
    `);
  } catch (err) {
    console.error('Error ensuring columns/tables:', err);
  }
})();

// Create leave_documents table if not exists
(async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS leave_documents (
        id SERIAL PRIMARY KEY,
        leave_id VARCHAR(20) REFERENCES leaves(id) ON DELETE CASCADE,
        file_name TEXT,
        file_url TEXT,
        file_size INTEGER,
        upload_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch (err) {
    console.error('Error creating leave_documents table:', err);
  }
})();

// Bulk update all employees' earned leave balance to 18 (GET version, unique path)
app.get('/api/employees/bulk-update-el-balance-all', async (req, res) => {
  console.log('Bulk update endpoint hit');
  try {
    const result = await pool.query(
      'UPDATE employees SET el_balance = 18 WHERE el_balance != 18 OR el_balance IS NULL RETURNING employee_id, el_balance'
    );
    res.json({ 
      success: true, 
      message: `Updated ${result.rows.length} employees' earned leave balance to 18`,
      updatedEmployees: result.rows
    });
  } catch (err) {
    console.error('Error bulk updating earned leave balance:', err);
    res.status(500).json({ error: err.message });
  }
});

// Delete employee by employee_id
app.delete('/api/employees/:employeeId', async (req, res) => {
  try {
    const { employeeId } = req.params;
    const result = await pool.query(
      'DELETE FROM employees WHERE employee_id = $1 RETURNING *',
      [employeeId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }
    res.json({ success: true, employee: result.rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Update employee by employee_id
app.patch('/api/employees/:employeeId', async (req, res) => {
  try {
    const { employeeId } = req.params;
    const {
      full_name, email, mobile_number, designation, role, 
      joining_date, current_posting, password, status
    } = req.body;

    // Build dynamic update query
    const updateFields = [];
    const updateValues = [];
    let paramCount = 1;

    if (full_name !== undefined) {
      updateFields.push(`full_name = $${paramCount++}`);
      updateValues.push(full_name);
    }
    if (email !== undefined) {
      updateFields.push(`email = $${paramCount++}`);
      updateValues.push(email);
    }
    if (mobile_number !== undefined) {
      updateFields.push(`mobile_number = $${paramCount++}`);
      updateValues.push(mobile_number);
    }
    if (designation !== undefined) {
      updateFields.push(`designation = $${paramCount++}`);
      updateValues.push(designation);
    }
    if (role !== undefined) {
      updateFields.push(`role = $${paramCount++}`);
      updateValues.push(role);
    }
    if (joining_date !== undefined) {
      updateFields.push(`joining_date = $${paramCount++}`);
      updateValues.push(joining_date);
    }
    if (current_posting !== undefined) {
      updateFields.push(`current_posting = $${paramCount++}`);
      updateValues.push(current_posting);
    }
    if (password !== undefined && password.trim() !== '') {
      updateFields.push(`password = $${paramCount++}`);
      updateValues.push(password);
    }
    if (status !== undefined) {
      updateFields.push(`status = $${paramCount++}`);
      updateValues.push(status);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updateValues.push(employeeId);
    const query = `
      UPDATE employees 
      SET ${updateFields.join(', ')} 
      WHERE employee_id = $${paramCount} 
      RETURNING *
    `;

    const result = await pool.query(query, updateValues);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    res.json({
      success: true,
      message: 'Profile updated successfully',
      employee: result.rows[0]
    });
  } catch (err) {
    console.error('Error updating employee:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update employee leave balances
app.patch('/api/employees/:employeeId/leave-balances', async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { cl_balance, rh_balance, el_balance } = req.body;

    // Build dynamic update query for leave balances
    const updateFields = [];
    const updateValues = [];
    let paramCount = 1;

    if (cl_balance !== undefined) {
      updateFields.push(`cl_balance = $${paramCount++}`);
      updateValues.push(cl_balance);
    }
    if (rh_balance !== undefined) {
      updateFields.push(`rh_balance = $${paramCount++}`);
      updateValues.push(rh_balance);
    }
    if (el_balance !== undefined) {
      updateFields.push(`el_balance = $${paramCount++}`);
      updateValues.push(el_balance);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No leave balance fields to update' });
    }

    updateValues.push(employeeId);
    const query = `
      UPDATE employees 
      SET ${updateFields.join(', ')} 
      WHERE employee_id = $${paramCount} 
      RETURNING *
    `;

    const result = await pool.query(query, updateValues);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error updating employee leave balances:', err);
    res.status(500).json({ error: err.message });
  }
});

// ...existing code...
// Routes
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query(
      `SELECT * FROM employees WHERE (email = $1 OR employee_id = $1) AND password = $2 AND status = 'Active'`,
      [email, password]
    );
    if (result.rows.length > 0) {
      const user = result.rows[0];
      res.json({
        success: true,
        user: {
          email: user.email,
          fullName: user.full_name,
          employeeId: user.employee_id,
          role: user.role,
          designation: user.designation
        }
      });
    } else {
      res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// Add new employee
app.post('/api/employees', async (req, res) => {
  const {
    employee_id, full_name, email, mobile_number,
    designation, role, joining_date, current_posting,
    password, status
  } = req.body;
  try {
    // First ensure the designation is not empty
    if (!designation) {
      return res.status(400).json({ error: 'Designation is required' });
    }

    const result = await pool.query(
      `INSERT INTO employees
      (employee_id, full_name, email, mobile_number, designation, role, joining_date, current_posting, password, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [employee_id, full_name, email, mobile_number, designation, role, joining_date, current_posting, password, status]
    );
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all employees
app.get('/api/employees', async (req, res) => {
  try {
    const { employee_id } = req.query;
    if (employee_id) {
      const result = await pool.query('SELECT * FROM employees WHERE employee_id = $1', [employee_id]);
      return res.json(result.rows);
    }
    const result = await pool.query('SELECT * FROM employees');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Submit leave request
app.post('/api/leaves', async (req, res) => {
  try {
    const { employeeId, type, startDate, endDate, reason, location } = req.body;
    
    // ===== VALIDATION SAFEGUARDS =====
    
    // Validate required fields
    if (!employeeId || !type || !startDate || !endDate) {
      return res.status(400).json({ 
        error: 'Missing required fields: employeeId, type, startDate, endDate' 
      });
    }
    
    // Validate leave type
    if (!validateLeaveType(type)) {
      return res.status(400).json({ 
        error: 'Invalid leave type. Must be CL, RH, or EL' 
      });
    }
    
    // Validate date range
    if (!validateDateRange(startDate, endDate)) {
      return res.status(400).json({ 
        error: 'Invalid date range. Start date must be today or later, and end date must be after start date' 
      });
    }
    
    // Calculate days using safeguard function
    const days = calculateLeaveDays(startDate, endDate);
    
    // Validate reason length
    if (reason && reason.length > 500) {
      return res.status(400).json({ 
        error: 'Reason is too long. Maximum 500 characters allowed' 
      });
    }
    
    // Get employee details including designation and balances
    const empResult = await pool.query(
      'SELECT full_name, designation, cl_balance, rh_balance, el_balance FROM employees WHERE employee_id = $1',
      [employeeId]
    );
    
    if (empResult.rows.length === 0) {
      console.error('Employee not found for employeeId:', employeeId);
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    const employee = empResult.rows[0];
    
    if (!employee.designation) {
      console.error('Employee designation not found for employeeId:', employeeId);
      return res.status(400).json({ error: 'Employee designation not found' });
    }
    
    // Check leave balance before submission
    let balanceColumn;
    let currentBalance;
    switch (type.toUpperCase()) {
      case 'CL':
        balanceColumn = 'cl_balance';
        currentBalance = normalizeLeaveBalance(employee.cl_balance);
        break;
      case 'RH':
        balanceColumn = 'rh_balance';
        currentBalance = normalizeLeaveBalance(employee.rh_balance);
        break;
      case 'EL':
        balanceColumn = 'el_balance';
        currentBalance = normalizeLeaveBalance(employee.el_balance);
        break;
      default:
        return res.status(400).json({ error: 'Invalid leave type' });
    }
    
    // Check if employee has sufficient balance
    if (currentBalance < days) {
      return res.status(400).json({ 
        error: `Insufficient leave balance. Current ${type} balance: ${currentBalance}, Requested: ${days} days` 
      });
    }
    
    // Check for overlapping leave requests
    const overlappingLeaves = await pool.query(
      `SELECT id, start_date, end_date, status 
       FROM leaves 
       WHERE employee_id = $1 
       AND status IN ('Pending', 'Approved')
       AND (
         (start_date <= $2 AND end_date >= $3) OR
         (start_date >= $2 AND start_date <= $3) OR
         (end_date >= $2 AND end_date <= $3)
       )`,
      [employeeId, startDate, endDate]
    );
    
    if (overlappingLeaves.rows.length > 0) {
      return res.status(400).json({ 
        error: 'You have overlapping leave requests for this date range' 
      });
    }
    
    // Ensure startDate and endDate are always ISO strings with time
    const startDateTime = (new Date(startDate)).toISOString();
    const endDateTime = (new Date(endDate)).toISOString();
    
    // Insert leave request
    const result = await pool.query(
      'INSERT INTO leaves (employee_id, employee_name, type, start_date, end_date, days, reason, status, applied_on, location, designation) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *',
      [employeeId, employee.full_name, type.toUpperCase(), startDateTime, endDateTime, days, reason, 'Pending', new Date(), location, employee.designation]
    );
    
    // Add notification for admin
    await pool.query(
      'INSERT INTO notifications (type, message, user_id) VALUES ($1, $2, NULL)',
      ['New Leave Request', `New leave request from ${employee.full_name} (${employeeId}) for ${type.toUpperCase()} from ${startDate} to ${endDate}.`,]
    );
    
    console.log(`Leave request submitted successfully: Employee ${employeeId}, Type ${type}, Days ${days}`);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('Error in POST /api/leaves:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get all leave requests
app.get('/api/leaves', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        l.*,
        COALESCE(l.designation, e.designation) as designation,
        e.designation as employee_designation
      FROM leaves l 
      LEFT JOIN employees e ON l.employee_id = e.employee_id 
      ORDER BY l.applied_on DESC
    `);

    const transformedData = result.rows.map(row => ({
      ...row,
      designation: row.designation || row.employee_designation || 'Not Specified'
    }));

    res.json(transformedData);
  } catch (err) {
    console.error('Error in /api/leaves:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get leave requests for specific employee
app.get('/api/leaves/:employeeId', async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT 
        l.*,
        COALESCE(l.designation, e.designation) as designation
      FROM leaves l 
      LEFT JOIN employees e ON l.employee_id = e.employee_id 
      WHERE l.employee_id = $1 
      ORDER BY l.applied_on DESC`,
      [req.params.employeeId]
    );
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Approve leave request
// FIXED: Leave balance deduction issues
// - Uses stored days from database instead of recalculating
// - Normalizes leave types for consistency
// - Validates days are reasonable for leave type
// - Adds comprehensive logging for debugging
// - Verifies balance update was successful
app.patch('/api/leaves/:id/approve', async (req, res) => {
  const client = await pool.connect();
  try {
    console.log('Starting leave approval process for ID:', req.params.id);
    await client.query('BEGIN');

    // Get the leave request details
    console.log('Fetching leave request details...');
    const leaveResult = await client.query(
      'SELECT l.*, e.designation as employee_designation FROM leaves l LEFT JOIN employees e ON l.employee_id = e.employee_id WHERE l.id::text = $1',
      [req.params.id]
    );
    console.log('Leave request result:', leaveResult.rows[0]);

    if (leaveResult.rows.length === 0) {
      console.log('Leave request not found');
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Leave request not found' });
    }

    const leave = leaveResult.rows[0];
    console.log('Leave details:', leave);

    // ===== VALIDATION SAFEGUARDS =====
    // Validate leave type
    const normalizedLeaveType = normalizeLeaveType(leave.type);
    if (!normalizedLeaveType) {
      console.log('Invalid leave type:', leave.type);
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Invalid leave type' });
    }

    // Check if leave is already approved
    if (leave.status === 'Approved') {
      console.log('Leave already approved');
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Leave request is already approved' });
    }

    // Check if leave is rejected or cancelled
    if (leave.status === 'Rejected' || leave.status === 'Cancelled') {
      console.log('Leave is already', leave.status);
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: `Leave request is already ${leave.status.toLowerCase()}` });
    }

    // Validate date range (no negative days)
    if (new Date(leave.end_date) < new Date(leave.start_date)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'End date cannot be before start date' });
    }

    // Use the stored days from the leave request instead of recalculating
    const validatedDays = leave.days || 1;
    
    // Validate that days is a positive number
    if (validatedDays < 1) {
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Leave days must be at least 1' });
    }

    // Validate that days are reasonable for the leave type
    if (!validateLeaveDays(validatedDays, normalizedLeaveType)) {
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false, 
        message: `Invalid number of days (${validatedDays}) for ${normalizedLeaveType} leave type` 
      });
    }

    // Get employee details
    console.log('Fetching employee details for ID:', leave.employee_id);
    const employeeResult = await client.query(
      'SELECT * FROM employees WHERE employee_id = $1',
      [leave.employee_id]
    );
    console.log('Employee result:', employeeResult.rows[0]);

    if (employeeResult.rows.length === 0) {
      console.log('Employee not found');
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }

    const employee = employeeResult.rows[0];

    // ===== BALANCE VALIDATION WITH NORMALIZATION =====
    let balanceColumn;
    let currentBalance;
    switch (normalizedLeaveType) {
      case 'CL':
        balanceColumn = 'cl_balance';
        currentBalance = normalizeLeaveBalance(employee.cl_balance);
        break;
      case 'RH':
        balanceColumn = 'rh_balance';
        currentBalance = normalizeLeaveBalance(employee.rh_balance);
        break;
      case 'EL':
        balanceColumn = 'el_balance';
        currentBalance = normalizeLeaveBalance(employee.el_balance);
        break;
      default:
        console.log('Invalid leave type:', leave.type);
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Invalid leave type' });
    }

    console.log('Leave balance check:', {
      type: leave.type,
      balanceColumn,
      currentBalance,
      requestedDays: validatedDays,
      originalDays: leave.days,
      employeeId: leave.employee_id,
      employeeName: leave.employee_name
    });

    if (currentBalance < validatedDays) {
      console.log('Insufficient balance - Current:', currentBalance, 'Requested:', validatedDays);
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false, 
        message: `Insufficient leave balance. Current ${leave.type} balance: ${currentBalance}, Requested: ${validatedDays} days` 
      });
    }

    // Check for overlapping approved leaves
    const overlappingApproved = await client.query(
      `SELECT id, start_date, end_date 
       FROM leaves 
       WHERE employee_id = $1 
       AND status = 'Approved'
       AND id::text != $2
       AND (
         (start_date <= $3 AND end_date >= $4) OR
         (start_date >= $3 AND start_date <= $4) OR
         (end_date >= $3 AND end_date <= $4)
       )`,
      [leave.employee_id, req.params.id, leave.start_date, leave.end_date]
    );

    if (overlappingApproved.rows.length > 0) {
      console.log('Overlapping approved leaves found');
      await client.query('ROLLBACK');
      return res.status(400).json({ 
        success: false, 
        message: 'Employee has overlapping approved leaves for this date range' 
      });
    }

    // Update leave status
    console.log('Updating leave status to Approved');
    const updateResult = await client.query(
      'UPDATE leaves SET status = $1, approved_date = $2, days = $3 WHERE id::text = $4 RETURNING *',
      ['Approved', new Date(), validatedDays, req.params.id]
    );

    // Deduct leave days from balance with safeguard
    console.log('Deducting leave balance:', {
      balanceColumn,
      daysToDeduct: validatedDays,
      employeeId: leave.employee_id,
      currentBalance
    });
    
    const newBalance = Math.max(0, currentBalance - validatedDays);
    await client.query(
      `UPDATE employees SET ${balanceColumn} = $1 WHERE employee_id = $2`,
      [newBalance, leave.employee_id]
    );

    // Verify the update was successful
    const verifyResult = await client.query(
      `SELECT ${balanceColumn} FROM employees WHERE employee_id = $1`,
      [leave.employee_id]
    );
    
    if (verifyResult.rows.length === 0) {
      throw new Error('Failed to verify balance update');
    }
    
    const updatedBalance = verifyResult.rows[0][balanceColumn];
    console.log(`Balance updated successfully: ${currentBalance} -> ${updatedBalance} (deducted: ${validatedDays} days)`);
    
    // Double-check that the deduction was correct
    if (updatedBalance !== newBalance) {
      console.error('Balance mismatch detected:', {
        expected: newBalance,
        actual: updatedBalance,
        difference: newBalance - updatedBalance
      });
      throw new Error('Balance update verification failed');
    }

    console.log('Committing transaction...');
    await client.query('COMMIT');
    console.log('Leave approval successful');
    
    res.json({ 
      success: true, 
      leave: updateResult.rows[0],
      balanceUpdated: {
        type: normalizedLeaveType,
        previousBalance: currentBalance,
        newBalance: updatedBalance,
        daysDeducted: validatedDays
      }
    });
  } catch (err) {
    console.error('Error in approve leave:', err);
    console.error('Error details:', {
      message: err.message,
      stack: err.stack,
      code: err.code,
      detail: err.detail
    });
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// Reject leave request
app.patch('/api/leaves/:id/reject', async (req, res) => {
  try {
    const { remarks } = req.body;
    const result = await pool.query(
      'UPDATE leaves SET status = $1, remarks = $2, rejected_date = $3 WHERE id::text = $4 RETURNING *',
      ['Rejected', remarks, new Date(), req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Leave request not found' });
    }

    res.json({ success: true, leave: result.rows[0] });
  } catch (err) {
    console.error('Error in reject leave:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Cancel leave request
app.patch('/api/leaves/:id/cancel', async (req, res) => {
  const client = await pool.connect();
  try {
    console.log('Starting leave cancellation process for ID:', req.params.id);
    await client.query('BEGIN');

    // Get the leave request details
    console.log('Fetching leave request details...');
    const leaveResult = await client.query(
      'SELECT * FROM leaves WHERE id::text = $1',
      [req.params.id]
    );
    console.log('Leave request found:', leaveResult.rows[0]);

    if (leaveResult.rows.length === 0) {
      console.log('Leave request not found');
      await client.query('ROLLBACK');
      return res.status(404).json({ success: false, message: 'Leave request not found' });
    }

    const leave = leaveResult.rows[0];
    console.log('Current leave status:', leave.status);

    // Check if leave is already cancelled
    if (leave.status === 'Cancelled') {
      console.log('Leave already cancelled');
      await client.query('ROLLBACK');
      return res.status(400).json({ success: false, message: 'Leave request is already cancelled' });
    }

    // Check if leave is already approved
    if (leave.status === 'Approved') {
      console.log('Leave is approved, restoring balance...');
      // If approved, restore the leave balance
      const normalizedLeaveType = normalizeLeaveType(leave.type);
      if (!normalizedLeaveType) {
        console.log('Invalid leave type for cancellation:', leave.type);
        await client.query('ROLLBACK');
        return res.status(400).json({ success: false, message: 'Invalid leave type' });
      }
      
      let balanceColumn;
      switch (normalizedLeaveType) {
        case 'CL':
          balanceColumn = 'cl_balance';
          break;
        case 'RH':
          balanceColumn = 'rh_balance';
          break;
        case 'EL':
          balanceColumn = 'el_balance';
          break;
        default:
          console.log('Invalid leave type:', leave.type);
          await client.query('ROLLBACK');
          return res.status(400).json({ success: false, message: 'Invalid leave type' });
      }

      // Restore leave balance
      console.log('Restoring balance for column:', balanceColumn, 'Days to restore:', leave.days);
      await pool.query(
        `UPDATE employees 
         SET ${balanceColumn} = ${balanceColumn} + $1 
         WHERE employee_id = $2`,
        [leave.days, leave.employee_id]
      );
    }

    // Update leave status to cancelled
    console.log('Updating leave status to Cancelled...');
    const updateResult = await client.query(
      'UPDATE leaves SET status = $1, remarks = $2, cancelled_date = $3 WHERE id::text = $4 RETURNING *',
      ['Cancelled', 'Cancelled by employee', new Date(), req.params.id]
    );
    console.log('Leave updated:', updateResult.rows[0]);

    await client.query('COMMIT');
    console.log('Transaction committed successfully');
    res.json({ success: true, leave: updateResult.rows[0] });
  } catch (err) {
    console.error('Error in cancel leave:', err);
    console.error('Error details:', {
      message: err.message,
      stack: err.stack,
      code: err.code,
      detail: err.detail
    });
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// Request leave cancellation (user side)
app.patch('/api/leaves/:id/request-cancel', async (req, res) => {
  try {
    const { cancel_reason, user_id } = req.body;
    const result = await pool.query(
      'UPDATE leaves SET cancel_request_status = $1, cancel_reason = $2 WHERE id::text = $3 RETURNING *',
      ['Requested', cancel_reason, req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Leave request not found' });
    }
    // Insert a notification for admin (global notification, user_id = NULL)
    await pool.query(
      'INSERT INTO notifications (type, message, user_id) VALUES ($1, $2, NULL)',
      ['Leave Cancellation Request', `Leave ID ${req.params.id} requested cancellation.`]
    );
    res.json({ success: true, leave: result.rows[0] });
  } catch (err) {
    console.error('Error in request-cancel:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Admin approves cancellation
app.patch('/api/leaves/:id/approve-cancel', async (req, res) => {
  try {
    // Find the leave to get the user_id and leave details
    const leaveResult = await pool.query('SELECT * FROM leaves WHERE id::text = $1', [req.params.id]);
    if (leaveResult.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Leave request not found' });
    }
    const leave = leaveResult.rows[0];
    const userId = leave.employee_id;

    // Approve the cancellation
    const result = await pool.query(
      'UPDATE leaves SET cancel_request_status = $1 WHERE id::text = $2 RETURNING *',
      ['Approved', req.params.id]
    );

    // Restore balance only if leave has not started yet
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const leaveStart = new Date(leave.start_date);
    leaveStart.setHours(0, 0, 0, 0);
    if (leaveStart > today) {
      // Determine balance column
      const normalizedLeaveType = normalizeLeaveType(leave.type);
      if (!normalizedLeaveType) {
        console.log('Invalid leave type for cancellation:', leave.type);
        return res.status(400).json({ success: false, message: 'Invalid leave type' });
      }
      
      let balanceColumn;
      switch (normalizedLeaveType) {
        case 'CL':
          balanceColumn = 'cl_balance';
          break;
        case 'RH':
          balanceColumn = 'rh_balance';
          break;
        case 'EL':
          balanceColumn = 'el_balance';
          break;
        default:
          console.log('Invalid leave type:', leave.type);
          return res.status(400).json({ success: false, message: 'Invalid leave type' });
      }

      // Restore leave balance
      console.log('Restoring balance for column:', balanceColumn, 'Days to restore:', leave.days);
      await pool.query(
        `UPDATE employees 
         SET ${balanceColumn} = ${balanceColumn} + $1 
         WHERE employee_id = $2`,
        [leave.days, leave.employee_id]
      );
    }

    // Insert notification for user
    if (userId) {
      await pool.query(
        'INSERT INTO notifications (type, message, user_id) VALUES ($1, $2, $3)',
        ['Leave Cancellation Approved', `Your leave cancellation for ID ${req.params.id} was approved.`, userId]
      );
    }
    res.json({ success: true, leave: result.rows[0] });
  } catch (err) {
    console.error('Error in approve-cancel:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Admin rejects cancellation
app.patch('/api/leaves/:id/reject-cancel', async (req, res) => {
  try {
    const { reason } = req.body;
    // Find the leave to get the user_id
    const leaveResult = await pool.query('SELECT employee_id FROM leaves WHERE id::text = $1', [req.params.id]);
    const userId = leaveResult.rows.length > 0 ? leaveResult.rows[0].employee_id : null;
    const result = await pool.query(
      'UPDATE leaves SET cancel_request_status = $1, cancel_reason = $2 WHERE id::text = $3 RETURNING *',
      ['Rejected', reason || 'Rejected by admin', req.params.id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Leave request not found' });
    }
    // Insert notification for user
    if (userId) {
      await pool.query(
        'INSERT INTO notifications (type, message, user_id) VALUES ($1, $2, $3)',
        ['Leave Cancellation Rejected', `Your leave cancellation for ID ${req.params.id} was rejected.`, userId]
      );
    }
    res.json({ success: true, leave: result.rows[0] });
  } catch (err) {
    console.error('Error in reject-cancel:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get notifications for a specific user
app.get('/api/notifications/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [userId]);
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching user notifications:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get notifications for admin/global
app.get('/api/notifications', async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM notifications WHERE user_id IS NULL ORDER BY created_at DESC LIMIT 50');
    res.json(result.rows);
  } catch (err) {
    console.error('Error fetching notifications:', err);
    res.status(500).json({ error: err.message });
  }
});

// Mark notification as read
app.patch('/api/notifications/:id/read', async (req, res) => {
  try {
    await pool.query('UPDATE notifications SET is_read = TRUE WHERE id = $1', [req.params.id]);
    res.json({ success: true });
  } catch (err) {
    console.error('Error marking notification as read:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get employee by employee_id (for Flutter)
app.get('/api/employees/:employeeId', async (req, res) => {
  try {
    const { employeeId } = req.params;
    console.log('Fetching employee profile for ID:', employeeId);
    
    const result = await pool.query(
      'SELECT * FROM employees WHERE LOWER(employee_id) = LOWER($1)',
      [employeeId]
    );
    
    if (result.rows.length === 0) {
      console.log('Employee not found for ID:', employeeId);
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    const employee = result.rows[0];
    console.log('Employee data found:', {
      employee_id: employee.employee_id,
      full_name: employee.full_name,
      current_posting: employee.current_posting,
      designation: employee.designation,
      email: employee.email
    });
    
    res.json(employee);
  } catch (err) {
    console.error('Error fetching employee:', err);
    res.status(500).json({ error: err.message });
  }
});

// Upload profile photo
app.post('/api/employees/upload_profile_photo', async (req, res) => {
  try {
    // For now, return a mock URL since we don't have file upload configured
    // In a real app, you would handle file upload to cloud storage
    const { employee_id } = req.body;
    
    if (!employee_id) {
      return res.status(400).json({ error: 'Employee ID is required' });
    }

    // Mock profile photo URL
    const profilePhotoUrl = `https://via.placeholder.com/150x150/007bff/ffffff?text=${employee_id.charAt(0).toUpperCase()}`;
    
    res.json({ 
      success: true, 
      message: 'Profile photo uploaded successfully',
      url: profilePhotoUrl 
    });
  } catch (err) {
    console.error('Error uploading profile photo:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get leave suggestions for the apply leave form
app.get('/api/leave-suggestions', async (req, res) => {
  try {
    // Return a list of common leave reasons
    const suggestions = [
      'Personal work',
      'Medical appointment',
      'Family function',
      'Emergency',
      'Wedding',
      'Travel',
      'Mental health day',
      'Religious observance',
      'Child care',
      'Home maintenance',
      'Legal matters',
      'Educational purpose',
      'Sports event',
      'Cultural event',
      'Volunteer work'
    ];
    res.json(suggestions);
  } catch (err) {
    console.error('Error fetching leave suggestions:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get user leave stats
app.get('/api/user/leave-stats', async (req, res) => {
  try {
    const { employee_id } = req.query;
    if (!employee_id) {
      return res.status(400).json({ error: 'Employee ID is required' });
    }

    // Get total leaves
    const totalResult = await pool.query(
      'SELECT COUNT(*) as total FROM leaves WHERE employee_id = $1',
      [employee_id]
    );

    // Get approved leaves
    const approvedResult = await pool.query(
      'SELECT COUNT(*) as approved FROM leaves WHERE employee_id = $1 AND status = $2',
      [employee_id, 'Approved']
    );

    // Get pending leaves
    const pendingResult = await pool.query(
      'SELECT COUNT(*) as pending FROM leaves WHERE employee_id = $1 AND status = $2',
      [employee_id, 'Pending']
    );

    // Get rejected leaves
    const rejectedResult = await pool.query(
      'SELECT COUNT(*) as rejected FROM leaves WHERE employee_id = $1 AND status = $2',
      [employee_id, 'Rejected']
    );

    res.json({
      total: parseInt(totalResult.rows[0].total),
      approved: parseInt(approvedResult.rows[0].approved),
      pending: parseInt(pendingResult.rows[0].pending),
      rejected: parseInt(rejectedResult.rows[0].rejected),
    });
  } catch (err) {
    console.error('Error fetching leave stats:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get user settings
app.get('/api/user/settings', async (req, res) => {
  try {
    const { employee_id } = req.query;
    if (!employee_id) {
      return res.status(400).json({ error: 'Employee ID is required' });
    }

    // For now, return default settings since we don't have a settings table
    res.json({
      pushNotifications: true,
      emailAlerts: true,
      leaveReminders: true,
      biometricAuth: false,
      theme: 'System',
      dateFormat: 'DD/MM/YYYY',
      language: 'English',
      sessionTimeout: 30,
    });
  } catch (err) {
    console.error('Error fetching user settings:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update user settings
app.put('/api/user/settings', async (req, res) => {
  try {
    const { employee_id, ...settings } = req.body;
    if (!employee_id) {
      return res.status(400).json({ error: 'Employee ID is required' });
    }

    // For now, just return success since we don't have a settings table
    res.json({
      success: true,
      message: 'Settings updated successfully',
      settings: settings,
    });
  } catch (err) {
    console.error('Error updating user settings:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get HR contact information
app.get('/api/hr/contact', async (req, res) => {
  try {
    res.json({
      department: 'Human Resources',
      email: 'hr@buidco.com',
      phone: '+91 8002659674',
      officeHours: '9:00 AM - 6:00 PM (IST)',
      address: 'BUIDCO Office, Patna, Bihar',
      emergencyContact: '+91 8002659674',
    });
  } catch (err) {
    console.error('Error fetching HR contact:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get company policies
app.get('/api/company/policies', async (req, res) => {
  try {
    res.json({
      casualLeave: {
        name: 'Casual Leave (CL)',
        daysPerYear: 10,
        description: 'For personal and family matters',
        approvalRequired: true,
        advanceNotice: '3 days'
      },
      earnedLeave: {
        name: 'Earned Leave (EL)',
        daysPerYear: 18,
        description: 'Accumulated leave based on service',
        approvalRequired: true,
        advanceNotice: '7 days'
      },
      restrictedHoliday: {
        name: 'Restricted Holiday (RH)',
        daysPerYear: 3,
        description: 'For religious and cultural observances',
        approvalRequired: true,
        advanceNotice: '1 day'
      },
      sickLeave: {
        name: 'Sick Leave',
        daysPerYear: 15,
        description: 'For medical emergencies',
        approvalRequired: false,
        advanceNotice: 'Same day'
      }
    });
  } catch (err) {
    console.error('Error fetching company policies:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update user password
app.put('/api/user/password', async (req, res) => {
  try {
    const { employee_id, currentPassword, newPassword } = req.body;
    if (!employee_id || !currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Employee ID, current password, and new password are required' });
    }

    // First verify current password
    const userResult = await pool.query(
      'SELECT password FROM employees WHERE employee_id = $1',
      [employee_id]
    );

    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    const currentStoredPassword = userResult.rows[0].password;
    if (currentStoredPassword !== currentPassword) {
      return res.status(400).json({ error: 'Current password is incorrect' });
    }

    // Update password
    await pool.query(
      'UPDATE employees SET password = $1 WHERE employee_id = $2',
      [newPassword, employee_id]
    );

    res.json({ 
      success: true, 
      message: 'Password updated successfully' 
    });
  } catch (err) {
    console.error('Error updating password:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update employee profile
app.put('/api/employees/profile', async (req, res) => {
  try {
    const { employee_id, full_name, email, phone, department, designation } = req.body;
    if (!employee_id) {
      return res.status(400).json({ error: 'Employee ID is required' });
    }

    // Build dynamic update query
    const updateFields = [];
    const updateValues = [];
    let paramCount = 1;

    if (full_name !== undefined) {
      updateFields.push(`full_name = $${paramCount++}`);
      updateValues.push(full_name);
    }
    if (email !== undefined) {
      updateFields.push(`email = $${paramCount++}`);
      updateValues.push(email);
    }
    if (phone !== undefined) {
      updateFields.push(`mobile_number = $${paramCount++}`);
      updateValues.push(phone);
    }
    if (department !== undefined) {
      updateFields.push(`current_posting = $${paramCount++}`);
      updateValues.push(department);
    }
    if (designation !== undefined) {
      updateFields.push(`designation = $${paramCount++}`);
      updateValues.push(designation);
    }

    if (updateFields.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    updateValues.push(employee_id);
    const query = `
      UPDATE employees 
      SET ${updateFields.join(', ')} 
      WHERE employee_id = $${paramCount} 
      RETURNING *
    `;

    const result = await pool.query(query, updateValues);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }

    res.json({
      success: true,
      message: 'Profile updated successfully',
      employee: result.rows[0]
    });
  } catch (err) {
    console.error('Error updating employee profile:', err);
    res.status(500).json({ error: err.message });
  }
});

// Cancel approved leave request
app.post('/api/leaves/cancel-approved', async (req, res) => {
  try {
    const { leave_id, employee_id, cancel_reason } = req.body;
    
    if (!leave_id || !employee_id) {
      return res.status(400).json({ error: 'Leave ID and Employee ID are required' });
    }

    // First check if the leave exists and is approved
    const leaveCheck = await pool.query(
      'SELECT * FROM leaves WHERE id::text = $1 AND employee_id = $2 AND status = $3',
      [leave_id, employee_id, 'Approved']
    );

    if (leaveCheck.rows.length === 0) {
      return res.status(404).json({ 
        error: 'Leave not found or not approved. Only approved leaves can be cancelled.' 
      });
    }

    const leave = leaveCheck.rows[0];
    const leaveStartDate = new Date(leave.start_date);
    const today = new Date();

    // 48 hour expiry logic
    const approvedDate = leave.approved_date ? new Date(leave.approved_date) : null;
    if (!approvedDate) {
      return res.status(400).json({ error: 'Leave does not have an approved date.' });
    }
    const diffHours = (today - approvedDate) / (1000 * 60 * 60);
    if (diffHours > 48) {
      return res.status(400).json({ error: 'Cancellation window expired (48 hours passed).' });
    }

    // Check if leave has already started
    if (leaveStartDate <= today) {
      return res.status(400).json({ 
        error: 'Cannot cancel leave that has already started or passed' 
      });
    }

    // Update leave status to cancelled
    const result = await pool.query(
      `UPDATE leaves 
       SET status = 'Cancelled', 
           cancel_request_status = 'Cancelled',
           cancel_reason = $1,
           updated_at = CURRENT_TIMESTAMP
       WHERE id::text = $2 AND employee_id = $3 
       RETURNING *`,
      [cancel_reason || 'Cancelled by employee', leave_id, employee_id]
    );

    if (result.rows.length === 0) {
      return res.status(500).json({ error: 'Failed to cancel leave' });
    }

    // Restore leave balance
    const leaveType = leave.leave_type ? leave.leave_type.toLowerCase() : (leave.type ? leave.type.toLowerCase() : '');
    let balanceColumn = '';
    
    if (leaveType.includes('casual')) {
      balanceColumn = 'cl_balance';
    } else if (leaveType.includes('earned')) {
      balanceColumn = 'el_balance';
    } else if (leaveType.includes('restricted')) {
      balanceColumn = 'rh_balance';
    }

    if (balanceColumn) {
      await pool.query(
        `UPDATE employees 
         SET ${balanceColumn} = ${balanceColumn} + $1 
         WHERE employee_id = $2`,
        [leave.duration || leave.days, employee_id]
      );
    }

    // Create notification for manager
    await pool.query(
      `INSERT INTO notifications (type, message, user_id, created_at) 
       VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`,
      [
        'leave_cancelled',
        `Leave request ${leave_id} has been cancelled by employee ${employee_id}`,
        leave.manager_id || 1 // Default manager ID if not set
      ]
    );

    res.json({
      success: true,
      message: 'Leave cancelled successfully',
      leave: result.rows[0],
      balanceRestored: balanceColumn ? true : false
    });

  } catch (err) {
    console.error('Error cancelling approved leave:', err);
    res.status(500).json({ error: err.message });
  }
});

// Upload document for a leave
app.post('/api/leaves/:id/upload-document', uploadLeaveDoc.single('document'), async (req, res) => {
  try {
    const leaveId = req.params.id;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    const fileUrl = `/uploads/leave_docs/${req.file.filename}`;
    const { originalname, size } = req.file;
    const result = await pool.query(
      'INSERT INTO leave_documents (leave_id, file_name, file_url, file_size) VALUES ($1, $2, $3, $4) RETURNING *',
      [leaveId, originalname, fileUrl, size]
    );
    res.json({ success: true, document: result.rows[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Update leave details API to include documents
app.get('/api/leaves/:id/details', async (req, res) => {
  try {
    const leaveResult = await pool.query('SELECT * FROM leaves WHERE id::text = $1', [req.params.id]);
    if (leaveResult.rows.length === 0) return res.status(404).json({ error: 'Leave not found' });
    const leave = leaveResult.rows[0];
    const docsResult = await pool.query('SELECT file_name, file_url, file_size, upload_date FROM leave_documents WHERE leave_id = $1', [req.params.id]);
    leave.documents = docsResult.rows;
    res.json(leave);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get all employees with debugging info
app.get('/api/employees/debug', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        employee_id, 
        full_name, 
        current_posting, 
        designation, 
        email,
        status
      FROM employees 
      ORDER BY employee_id
    `);
    
    console.log('All employees data:', result.rows);
    res.json({
      count: result.rows.length,
      employees: result.rows
    });
  } catch (err) {
    console.error('Error fetching all employees:', err);
    res.status(500).json({ error: err.message });
  }
});

// Update employee name and posting (for fixing data)
app.patch('/api/employees/:employeeId/fix-data', async (req, res) => {
  try {
    const { employeeId } = req.params;
    const { full_name, current_posting } = req.body;
    
    if (!full_name || !current_posting) {
      return res.status(400).json({ 
        error: 'Both full_name and current_posting are required' 
      });
    }
    
    const result = await pool.query(
      `UPDATE employees 
       SET full_name = $1, current_posting = $2 
       WHERE LOWER(employee_id) = LOWER($3) 
       RETURNING employee_id, full_name, current_posting`,
      [full_name, current_posting, employeeId]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Employee not found' });
    }
    
    console.log('Updated employee data:', result.rows[0]);
    res.json({
      success: true,
      message: 'Employee data updated successfully',
      employee: result.rows[0]
    });
  } catch (err) {
    console.error('Error updating employee data:', err);
    res.status(500).json({ error: err.message });
  }
});

// Get employee profile with leave balances
app.get('/api/employees/:employeeId/profile', async (req, res) => {
  try {
    const { employeeId } = req.params;
    
    // Validate employee ID
    if (!employeeId || employeeId.trim() === '') {
      return res.status(400).json({ success: false, message: 'Employee ID is required' });
    }
    
    const result = await pool.query(
      'SELECT * FROM employees WHERE LOWER(employee_id) = LOWER($1)',
      [employeeId.trim()]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }
    
    const employee = result.rows[0];
    
    // Normalize balances before returning
    const normalizedEmployee = {
      ...employee,
      cl_balance: normalizeLeaveBalance(employee.cl_balance),
      rh_balance: normalizeLeaveBalance(employee.rh_balance),
      el_balance: normalizeLeaveBalance(employee.el_balance)
    };
    
    res.json({ success: true, employee: normalizedEmployee });
  } catch (err) {
    console.error('Error fetching employee profile:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Fix employee balances endpoint
app.post('/api/employees/:employeeId/fix-balances', async (req, res) => {
  try {
    const { employeeId } = req.params;
    
    if (!employeeId || employeeId.trim() === '') {
      return res.status(400).json({ success: false, message: 'Employee ID is required' });
    }
    
    // Check if employee exists
    const employeeCheck = await pool.query(
      'SELECT employee_id, full_name FROM employees WHERE LOWER(employee_id) = LOWER($1)',
      [employeeId.trim()]
    );
    
    if (employeeCheck.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Employee not found' });
    }
    
    // Normalize balances
    const normalizedBalances = await normalizeEmployeeBalances(employeeId.trim());
    
    res.json({
      success: true,
      message: 'Employee balances fixed successfully',
      employee: {
        employee_id: employeeId,
        full_name: employeeCheck.rows[0].full_name,
        ...normalizedBalances
      }
    });
  } catch (err) {
    console.error('Error fixing employee balances:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Bulk fix all employee balances
app.post('/api/employees/fix-all-balances', async (req, res) => {
  try {
    // Get all employees
    const employees = await pool.query('SELECT employee_id, full_name FROM employees');
    
    const results = [];
    const errors = [];
    
    for (const employee of employees.rows) {
      try {
        const normalizedBalances = await normalizeEmployeeBalances(employee.employee_id);
        results.push({
          employee_id: employee.employee_id,
          full_name: employee.full_name,
          ...normalizedBalances
        });
      } catch (err) {
        errors.push({
          employee_id: employee.employee_id,
          full_name: employee.full_name,
          error: err.message
        });
      }
    }
    
    res.json({
      success: true,
      message: `Fixed balances for ${results.length} employees`,
      fixed: results.length,
      errors: errors.length,
      results,
      errors
    });
  } catch (err) {
    console.error('Error in bulk balance fix:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Get system health and data integrity status
app.get('/api/system/health', async (req, res) => {
  try {
    // Check database connection
    const dbCheck = await pool.query('SELECT NOW()');
    
    // Check for data integrity issues
    const negativeBalances = await pool.query(`
      SELECT COUNT(*) as count FROM employees 
      WHERE cl_balance < 0 OR rh_balance < 0 OR el_balance < 0
    `);
    
    const highBalances = await pool.query(`
      SELECT COUNT(*) as count FROM employees 
      WHERE cl_balance > 30 OR rh_balance > 15 OR el_balance > 30
    `);
    
    const totalEmployees = await pool.query('SELECT COUNT(*) as count FROM employees');
    const totalLeaves = await pool.query('SELECT COUNT(*) as count FROM leaves');
    
    res.json({
      success: true,
      system: {
        database: 'connected',
        timestamp: dbCheck.rows[0].now
      },
      dataIntegrity: {
        totalEmployees: totalEmployees.rows[0].count,
        totalLeaves: totalLeaves.rows[0].count,
        negativeBalances: negativeBalances.rows[0].count,
        highBalances: highBalances.rows[0].count,
        needsAttention: (negativeBalances.rows[0].count > 0 || highBalances.rows[0].count > 0)
      }
    });
  } catch (err) {
    console.error('Error checking system health:', err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Test endpoint to create sample notifications
app.post('/api/notifications/test', async (req, res) => {
  try {
    const { userId } = req.body;
    
    // Create some test notifications
    const testNotifications = [
      {
        type: 'Leave Approved',
        message: 'Your leave request for CL from 2024-01-15 to 2024-01-17 has been approved.',
        user_id: userId
      },
      {
        type: 'Leave Request',
        message: 'New leave request submitted by employee EMP001 for RH on 2024-01-20.',
        user_id: null // Global notification for admin
      },
      {
        type: 'System Update',
        message: 'System maintenance scheduled for tomorrow at 2:00 AM.',
        user_id: userId
      }
    ];

    for (const notification of testNotifications) {
      await pool.query(
        'INSERT INTO notifications (type, message, user_id, is_read) VALUES ($1, $2, $3, FALSE)',
        [notification.type, notification.message, notification.user_id]
      );
    }

    res.json({ 
      success: true, 
      message: 'Test notifications created successfully',
      count: testNotifications.length
    });
  } catch (err) {
    console.error('Error creating test notifications:', err);
    res.status(500).json({ error: err.message });
  }
});

// Start server
app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

app.use('/uploads', express.static(path.join(__dirname, 'uploads'))); 