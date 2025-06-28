// Test script to verify leave balance deduction
const { Pool } = require('pg');

const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'employee_nexus',
  password: 'your_password',
  port: 5432,
});

async function testLeaveBalanceDeduction() {
  const client = await pool.connect();
  try {
    console.log('Testing leave balance deduction...');
    
    // Test 1: Check if an employee exists
    const employeeResult = await client.query(
      'SELECT employee_id, full_name, cl_balance, rh_balance, el_balance FROM employees LIMIT 1'
    );
    
    if (employeeResult.rows.length === 0) {
      console.log('No employees found in database');
      return;
    }
    
    const employee = employeeResult.rows[0];
    console.log('Testing with employee:', employee.full_name);
    console.log('Initial balances - CL:', employee.cl_balance, 'RH:', employee.rh_balance, 'EL:', employee.el_balance);
    
    // Test 2: Create a test leave request
    const testLeave = {
      employee_id: employee.employee_id,
      employee_name: employee.full_name,
      type: 'CL',
      start_date: '2024-01-15',
      end_date: '2024-01-17', // 3 days
      days: 3,
      reason: 'Test leave for balance deduction',
      status: 'Pending',
      applied_on: new Date(),
      location: 'Test Location',
      designation: 'EE'
    };
    
    const leaveResult = await client.query(
      'INSERT INTO leaves (employee_id, employee_name, type, start_date, end_date, days, reason, status, applied_on, location, designation) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *',
      [testLeave.employee_id, testLeave.employee_name, testLeave.type, testLeave.start_date, testLeave.end_date, testLeave.days, testLeave.reason, testLeave.status, testLeave.applied_on, testLeave.location, testLeave.designation]
    );
    
    const leaveId = leaveResult.rows[0].id;
    console.log('Created test leave with ID:', leaveId);
    
    // Test 3: Get current balance before approval
    const beforeBalance = await client.query(
      'SELECT cl_balance FROM employees WHERE employee_id = $1',
      [employee.employee_id]
    );
    console.log('Balance before approval:', beforeBalance.rows[0].cl_balance);
    
    // Test 4: Approve the leave (this should deduct balance)
    const approvalResponse = await fetch(`http://localhost:5000/api/leaves/${leaveId}/approve`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' }
    });
    
    if (approvalResponse.ok) {
      const approvalResult = await approvalResponse.json();
      console.log('Leave approved successfully');
      console.log('Balance update details:', approvalResult.balanceUpdated);
      
      // Test 5: Verify balance was deducted
      const afterBalance = await client.query(
        'SELECT cl_balance FROM employees WHERE employee_id = $1',
        [employee.employee_id]
      );
      console.log('Balance after approval:', afterBalance.rows[0].cl_balance);
      
      const expectedBalance = beforeBalance.rows[0].cl_balance - testLeave.days;
      console.log('Expected balance:', expectedBalance);
      
      if (afterBalance.rows[0].cl_balance === expectedBalance) {
        console.log('✅ Balance deduction test PASSED');
      } else {
        console.log('❌ Balance deduction test FAILED');
        console.log('Expected:', expectedBalance, 'Actual:', afterBalance.rows[0].cl_balance);
      }
    } else {
      console.log('❌ Leave approval failed');
      const errorResult = await approvalResponse.json();
      console.log('Error:', errorResult);
    }
    
    // Clean up: Delete test leave
    await client.query('DELETE FROM leaves WHERE id = $1', [leaveId]);
    console.log('Test leave cleaned up');
    
  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    client.release();
    await pool.end();
  }
}

// Run the test
testLeaveBalanceDeduction(); 