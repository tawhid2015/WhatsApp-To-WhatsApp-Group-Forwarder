module.exports = {
  apps: [{
    name: 'whatsapp-forwarder',           // PM2 process name
    script: './web-dashboard.js',         // Entry point
    cwd: '/home/node/.openclaw/workspace/whatsapp-forwarder',
    
    // Auto-restart settings
    autorestart: true,                    // Restart on crash
    max_restarts: 50,                     // Max restarts before giving up
    min_uptime: '5s',                     // Must be up 5s to count as stable
    restart_delay: 3000,                  // Wait 3s before restart
    max_memory_restart: '512M',           // Restart if memory > 512MB
    
    // Logging
    log_file: './logs/pm2-combined.log',
    out_file: './logs/pm2-out.log',
    error_file: './logs/pm2-error.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    
    // Environment
    env: {
      NODE_ENV: 'production',
      PORT: '3000'
    },
    
    // Run as single instance
    instances: 1,
    exec_mode: 'fork',
    
    // Don't restart if crashing too fast
    exp_backoff_restart_delay: 100,
    
    // Monitoring
    watch: true,                          // Watch files for updates
    ignore_watch: ['node_modules', 'logs', 'auth_info']
  }]
};
