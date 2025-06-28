# Railway Deployment Guide

## Step 1: Railway Account Setup

1. Go to https://railway.app/
2. Sign up/Login with GitHub
3. Create new project

## Step 2: Connect Repository

1. Click "Deploy from GitHub repo"
2. Select your backend repository
3. Railway will auto-detect Node.js

## Step 3: Environment Variables Setup

In Railway dashboard, add these environment variables:

```
DB_USER=postgres
DB_HOST=your-railway-postgres-host
DB_NAME=railway
DB_PASSWORD=your-railway-postgres-password
DB_PORT=5432
NODE_ENV=production
PORT=5000
```

## Step 4: Add PostgreSQL Database

1. In Railway project, click "New"
2. Select "Database" → "PostgreSQL"
3. Railway will auto-generate connection details
4. Copy the connection details to environment variables

## Step 5: Deploy

1. Railway will auto-deploy when you push to GitHub
2. Or click "Deploy" button manually
3. Wait for deployment to complete

## Step 6: Get Your URL

1. Railway will provide a URL like: `https://your-app-name.railway.app`
2. Use this URL in your frontend app

## Troubleshooting

- Check Railway logs for errors
- Verify environment variables are set correctly
- Ensure PostgreSQL database is connected

## Local Testing

```bash
npm start
```
