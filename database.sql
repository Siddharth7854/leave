-- Create employees table
CREATE TABLE
IF NOT EXISTS employees
(
    id SERIAL PRIMARY KEY,
    employee_id VARCHAR
(50) UNIQUE NOT NULL,
    full_name VARCHAR
(255) NOT NULL,
    email VARCHAR
(255) UNIQUE,
    mobile_number VARCHAR
(20),
    designation VARCHAR
(255),
    role VARCHAR
(50) DEFAULT 'Employee',
    joining_date DATE,
    current_posting VARCHAR
(255),
    password VARCHAR
(255) NOT NULL,
    status VARCHAR
(20) DEFAULT 'Active',
    cl_balance INTEGER DEFAULT 10,
    rh_balance INTEGER DEFAULT 5,
    el_balance INTEGER DEFAULT 18,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create leaves table
CREATE TABLE
IF NOT EXISTS leaves
(
    id SERIAL PRIMARY KEY,
    employee_id VARCHAR
(50) REFERENCES employees
(employee_id),
    employee_name VARCHAR
(255),
    type VARCHAR
(10) NOT NULL CHECK
(type IN
('CL', 'RH', 'EL')),
    start_date TIMESTAMP NOT NULL,
    end_date TIMESTAMP NOT NULL,
    days INTEGER NOT NULL,
    reason TEXT,
    status VARCHAR
(20) DEFAULT 'Pending' CHECK
(status IN
('Pending', 'Approved', 'Rejected', 'Cancelled')),
    applied_on TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    approved_date TIMESTAMP,
    rejected_date TIMESTAMP,
    cancelled_date TIMESTAMP,
    remarks TEXT,
    location VARCHAR
(255),
    designation VARCHAR
(255),
    cancel_request_status VARCHAR
(20),
    cancel_reason TEXT
);

-- Create notifications table
CREATE TABLE
IF NOT EXISTS notifications
(
    id SERIAL PRIMARY KEY,
    type VARCHAR
(50),
    message TEXT,
    is_read BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    user_id INTEGER
);

-- Create leave_documents table
CREATE TABLE
IF NOT EXISTS leave_documents
(
    id SERIAL PRIMARY KEY,
    leave_id VARCHAR
(20) REFERENCES leaves
(id) ON
DELETE CASCADE,
    file_name TEXT,
    file_url TEXT,
    file_size INTEGER,
    upload_date TIMESTAMP
DEFAULT CURRENT_TIMESTAMP
);

-- Insert sample employee data
INSERT INTO employees
    (employee_id, full_name, email, mobile_number, designation, role, joining_date, current_posting, password, status)
VALUES
    ('EMP001', 'John Doe', 'john.doe@buidco.com', '9876543210', 'Software Engineer', 'Employee', '2023-01-15', 'Patna', 'password123', 'Active'),
    ('EMP002', 'Jane Smith', 'jane.smith@buidco.com', '9876543211', 'HR Manager', 'Admin', '2022-06-01', 'Patna', 'password123', 'Active')
ON CONFLICT
(employee_id) DO NOTHING;

-- Create indexes for better performance
CREATE INDEX
IF NOT EXISTS idx_employees_employee_id ON employees
(employee_id);
CREATE INDEX
IF NOT EXISTS idx_leaves_employee_id ON leaves
(employee_id);
CREATE INDEX
IF NOT EXISTS idx_leaves_status ON leaves
(status);
CREATE INDEX
IF NOT EXISTS idx_notifications_user_id ON notifications
(user_id); 