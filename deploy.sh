#!/bin/bash

# Stop on any error
set -e

echo "Starting deployment..."

# 1. Install dependencies
echo "Installing dependencies..."
cd server
pip install -r requirements.txt
cd ../
npm install

# 2. Build frontend
echo "Building frontend..."
npm run build

# 3. Start backend server
echo "Starting backend server..."
cd server
nohup python reddit_service.py &
cd ../

# 4. Copy nginx configuration
echo "Setting up nginx..."
sudo cp server.conf /etc/nginx/sites-available/redscrape.conf
sudo ln -sf /etc/nginx/sites-available/redscrape.conf /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx

echo "Deployment complete!"
