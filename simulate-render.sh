#!/bin/bash
# This script simulates the Render environment locally

# Set environment variables
export NODE_ENV=production
export PORT=3000

# Create the data directory structure similar to Render
mkdir -p /tmp/render-data

# Set the mountpoint that would be used on Render
export RENDER_MOUNT=/tmp/render-data

# Copy the database to the simulated mount point
mkdir -p /tmp/render-data/data
cp -n data/lp_bot.db /tmp/render-data/data/ 2>/dev/null || echo "Database already exists or couldn't be copied"

# Build and run the application
echo "Building the application..."
npm run build

echo "Starting the application in production mode..."
node dist/index.js 