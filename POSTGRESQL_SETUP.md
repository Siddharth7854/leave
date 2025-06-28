# PostgreSQL Setup Guide

## Step 1: Install PostgreSQL

1. Download from: https://www.postgresql.org/download/windows/
2. Install with password: `sid91221`
3. Keep default port: `5432`

## Step 2: Create Database

1. Open pgAdmin
2. Connect to server (password: `sid91221`)
3. Right click "Databases" → "Create" → "Database"
4. Name: `buidco_leave`

## Step 3: Run SQL Script

1. In pgAdmin, right click on `buidco_leave` database
2. Select "Query Tool"
3. Copy and paste the contents of `setup_database.sql`
4. Click "Execute" (F5)

## Step 4: Test Connection

Run the server:

```bash
npm start
```

`

## Troubleshooting

- If connection fails, check if PostgreSQL service is running
- Verify database name is exactly: `buidco_leave`
- Check password is: `sid91221`
