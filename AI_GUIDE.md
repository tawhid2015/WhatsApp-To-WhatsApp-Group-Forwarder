# AI Guide - WhatsApp Forwarder

## Quick Commands

### Check Status
```bash
pm2 status
pm2 logs whatsapp-forwarder --lines 20
```

### Start/Stop/Restart
```bash
pm2 start whatsapp-forwarder
pm2 stop whatsapp-forwarder
pm2 restart whatsapp-forwarder
```

### Full Reset (if broken)
```bash
pm2 delete whatsapp-forwarder
pm2 start /root/.openclaw/workspace/whatsapp-forwarder/web-dashboard.js --name whatsapp-forwarder
pm2 save
```

## Common Issues

### Dashboard Blank
```bash
pm2 restart whatsapp-forwarder
curl http://localhost:3000
```

### QR Not Showing
- Check port 3000: `curl http://localhost:3000`
- Check firewall: `ufw status`
- Restart: `pm2 restart whatsapp-forwarder`

### Messages Not Forwarding
1. Check logs: `pm2 logs`
2. Verify config: `cat /root/.openclaw/workspace/whatsapp-forwarder/config.js`
3. Check groups: `node /root/.openclaw/workspace/whatsapp-forwarder/list-groups.js`

### Connection Lost
- Auto-reconnects in 5 seconds
- If persistent: `pm2 restart whatsapp-forwarder`

## Configuration

### Change Password
Edit `web-dashboard.js`:
```javascript
const DASHBOARD_PASSWORD = 'new-password';
```
Then restart: `pm2 restart whatsapp-forwarder`

### Change Groups
1. Open dashboard
2. Enter password
3. Click new source/target groups
4. Click Save

### Manual Config Edit
Edit `config.js`:
```javascript
module.exports = {
    SOURCE_GROUP_ID: 'new-source-id@g.us',
    TARGET_GROUP_ID: 'new-target-id@g.us',
    FORWARD_ALL_MESSAGES: true,
};
```
Then restart: `pm2 restart whatsapp-forwarder`

## File Locations

- Main app: `/root/.openclaw/workspace/whatsapp-forwarder/web-dashboard.js`
- Config: `/root/.openclaw/workspace/whatsapp-forwarder/config.js`
- Auth: `/root/.openclaw/workspace/whatsapp-forwarder/auth_info/`
- Logs: `/root/.pm2/logs/`

## Emergency Commands

```bash
# Kill everything
pm2 delete all
pkill -f node

# Start fresh
pm2 start /root/.openclaw/workspace/whatsapp-forwarder/web-dashboard.js --name whatsapp-forwarder
pm2 save

# Check what's running
ps aux | grep node
pm2 status
```

## Current Setup

- **Server:** 187.127.170.209:3000
- **Password:** tawhid123
- **Source:** 120363409268743119@g.us (Group A)
- **Target:** 120363425610613895@g.us (Group B)
- **Status:** Running with PM2
