# BUIDCO Leave Management System - Setup Guide

## Database Setup

### Option 1: Using Docker (Recommended)

1. **Install Docker Desktop** from https://www.docker.com/products/docker-desktop/

2. **Start PostgreSQL Database**:

   ```bash
   docker-compose up -d
   ```

3. **Verify Database is Running**:
   ```bash
   docker ps
   ```

### Option 2: Local PostgreSQL Installation

1. **Install PostgreSQL** from https://www.postgresql.org/download/

2. **Create Database**:

   ```sql
   CREATE DATABASE buidco_leave;
   ```

3. **Run SQL Script** (database.sql):
   ```bash
   psql -U postgres -d buidco_leave -f database.sql
   ```

## Environment Configuration

1. **Install Dependencies**:

   ```bash
   npm install
   ```

2. **Environment Variables** (.env file is already created):
   ```
   DB_USER=postgres
   DB_HOST=localhost
   DB_NAME=buidco_leave
   DB_PASSWORD=sid91221
   DB_PORT=5432
   PORT=5000
   NODE_ENV=development
   ```

## Start the Application

```bash
npm start
```

## Database Tables Structure

### Employees Table

- employee_id (VARCHAR, UNIQUE)
- full_name, email, mobile_number
- designation, role, joining_date
- leave balances (cl_balance, rh_balance, el_balance)

### Leaves Table

- employee_id (Foreign Key)
- type (CL/RH/EL), start_date, end_date
- status (Pending/Approved/Rejected/Cancelled)
- reason, location, designation

### Notifications Table

- type, message, is_read
- user_id (for user-specific notifications)

## Troubleshooting

### Connection Error: ECONNREFUSED

1. Check if PostgreSQL is running
2. Verify database credentials in .env
3. Ensure database 'buidco_leave' exists
4. Check firewall settings

### Permission Errors

1. Ensure PostgreSQL user has proper permissions
2. Check database ownership and access rights

## Sample Data

The system comes with sample employees:

- EMP001: John Doe (Software Engineer)
- EMP002: Jane Smith (HR Manager)

Login credentials: password123
