#!/bin/bash

# WhatsApp Forwarder Quick Start Script
# Usage: ./quick-start.sh [start|stop|restart|status|logs]

ACTION=${1:-start}
LOG_FILE="logs/forwarder.log"
PID_FILE="forwarder.pid"

# Create logs directory if not exists
mkdir -p logs

case $ACTION in
    start)
        echo "🚀 Starting WhatsApp Forwarder..."
        
        # Check if already running
        if [ -f "$PID_FILE" ] && ps -p $(cat "$PID_FILE") > /dev/null 2>&1; then
            echo "⚠️  Already running (PID: $(cat $PID_FILE))"
            exit 1
        fi
        
        # Kill any existing node processes
        pkill -f "node start.js" 2>/dev/null
        sleep 1
        
        # Start
        nohup node start.js > "$LOG_FILE" 2>&1 &
        echo $! > "$PID_FILE"
        
        echo "✅ Started (PID: $!)"
        echo "🌐 Web QR: http://187.127.170.209:3000"
        echo "📋 Logs: tail -f $LOG_FILE"
        sleep 2
        tail -10 "$LOG_FILE"
        ;;
        
    stop)
        echo "🛑 Stopping WhatsApp Forwarder..."
        
        if [ -f "$PID_FILE" ]; then
            kill $(cat "$PID_FILE") 2>/dev/null
            rm -f "$PID_FILE"
        fi
        
        pkill -f "node start.js" 2>/dev/null
        echo "✅ Stopped"
        ;;
        
    restart)
        echo "🔄 Restarting..."
        $0 stop
        sleep 2
        $0 start
        ;;
        
    status)
        if [ -f "$PID_FILE" ] && ps -p $(cat "$PID_FILE") > /dev/null 2>&1; then
            echo "✅ Running (PID: $(cat $PID_FILE))"
            echo "🌐 Web QR: http://187.127.170.209:3000"
        else
            echo "❌ Not running"
        fi
        ;;
        
    logs)
        echo "📋 Showing logs (Ctrl+C to exit)..."
        tail -f "$LOG_FILE"
        ;;
        
    fresh)
        echo "🆕 Fresh start (clearing auth)..."
        $0 stop
        rm -rf auth_info
        mkdir -p auth_info
        $0 start
        ;;
        
    *)
        echo "Usage: $0 [start|stop|restart|status|logs|fresh]"
        echo ""
        echo "Commands:"
        echo "  start   - Start the forwarder"
        echo "  stop    - Stop the forwarder"
        echo "  restart - Restart the forwarder"
        echo "  status  - Check if running"
        echo "  logs    - View logs"
        echo "  fresh   - Clear auth and start fresh (requires QR rescan)"
        ;;
esac
