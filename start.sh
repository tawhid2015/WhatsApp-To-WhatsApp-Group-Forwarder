#!/bin/bash
cd ~/.openclaw/workspace/whatsapp-forwarder
# Kill any existing
pkill -f "web-dashboard.js" 2>/dev/null
sleep 1
# Fresh auth
rm -rf auth_info
mkdir -p auth_info
# Clear any port 3000 listeners
lsof -ti:3000 | xargs kill -9 2>/dev/null
# Start detached
nohup node web-dashboard.js >> logs/forwarder.log 2>&1 < /dev/null &
echo $! > /tmp/wa-server.pid
echo "Server started with PID $(cat /tmp/wa-server.pid)"
