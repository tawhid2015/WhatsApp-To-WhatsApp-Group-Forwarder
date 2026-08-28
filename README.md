# WhatsApp Group-to-Group Message Forwarder

> A lightweight Node.js forwarder that copies WhatsApp messages from one group to another, with web-based configuration, admin-only filtering, and full media support.

---

## What It Does

This tool runs as a WhatsApp Web client via [`@whiskeysockets/baileys`](https://github.com/WhiskeySockets/Baileys). You log in via a QR code presented on a web dashboard, then select a **source group** (where messages come in) and a **target group** (where messages go out). Every message from the source is forwarded to the target.

You can run in two modes:
- **All Messages** — every incoming message is forwarded
- **Admin Only** — only messages from selected admin phone numbers are forwarded

Media support includes: **text, images, videos, audio, documents, and stickers**.

---

## Tech Stack

| Layer | Technology |
|---|---|
| WhatsApp Web API | `@whiskeysockets/baileys` v7.0.0-rc14 |
| Web Dashboard | Plain Node.js `http` server (no framework needed) |
| QR Code Generation | `qrcode` |
| Process Manager | `PM2` (recommended for production) |
| Authentication | Baileys multi-file auth state (`./auth_info`) |

---

## Quick Start (Any Server)

```bash
# 1. Clone
git clone https://github.com/designertawhid/WhatsApp-To-WhatsApp-Group-Forwarder.git
cd WhatsApp-To-WhatsApp-Group-Forwarder

# 2. Install dependencies
npm install

# 3. Start with PM2
pm2 start ecosystem.config.js

# 4. Open the dashboard (default port 3000)
#    http://YOUR_SERVER_IP:3000
```

On first start, the dashboard will show a **QR code**. Open WhatsApp on your phone → Settings → Linked Devices → Link a Device → scan the code.

---

## File Structure

```
.
├── web-dashboard.js         # Main application — Baileys + HTTP server + forwarding logic
├── ecosystem.config.js      # PM2 process configuration
├── config.js                # Runtime settings (auto-generated on first save)
├── auth_info/               # Baileys session files (auto-generated)
└── package.json             # Dependencies
```

---

## Architecture

### Core Flow

```
Phone sends message → WhatsApp servers → Baileys socket
                                                         │
                              ┌──────────────────────────┘
                              ▼
                    messages.upsert event fires
                              │
                              ├─ Check: is this the SOURCE group?
                              ├─ Check: is Admin Only enabled?
                              │     └─ If yes: is sender in ADMIN_NUMBERS?
                              │
                              └─ Download media (if image/video/audio/doc/sticker)
                                  Re-send to TARGET group
```

### Why Not Just `{ forward: msg }`?

Baileys supports `sock.sendMessage(target, { forward: msg })`, which seems like the perfect one-liner. **It does NOT work for media.**

**Why it fails:** When WhatsApp sends an image, WhatsApp's servers hold the actual file bytes. The incoming message only contains metadata (URL, encryption key, etc.). If you try to "forward" that message object directly, the target group receives an empty/broken message.

**The fix (critical):**

```js
const { downloadMediaMessage } = require('@whiskeysockets/baileys');

// For images — download THEN send
const buffer = await downloadMediaMessage(msg, 'buffer');
await sock.sendMessage(selectedTarget, {
    image: buffer,
    caption: msg.message.imageMessage?.caption || ''
});
```

The same pattern applies to `video`, `audio`, `document`, and `sticker` messages. Text messages (`conversation`, `extendedTextMessage`) can be forwarded directly without downloading.

---

## Configuration (`config.js`)

Auto-generated when you click **"Save Selection"** in the dashboard.

```javascript
module.exports = {
    SOURCE_GROUP_ID: '120363409268743119@g.us',  // Where messages come FROM
    TARGET_GROUP_ID: '120363411531137776@g.us',  // Where messages go TO
    FORWARD_ALL_MESSAGES: false,                  // true = forward everything
    FORWARD_ADMIN_ONLY: true,                     // true = only forward from selected admins
    ADMIN_NUMBERS: ['8801305005526'],             // Allowed sender numbers
};
```

### How Group IDs Look

WhatsApp group IDs are **JIDs** (Jabber IDs) like:
```
120363409268743119@g.us
```

These are NOT invitations links or group names — they are WhatsApp's internal identifiers.

---

## Features We Built

### 1. Admin-Only Forwarding

Instead of forwarding everything, you can restrict forwarding to specific trusted members.

**Dashboard UI:**
- Toggle button switches between "Admin Only" and "All Messages"
- When "Admin Only" is active, allowed admins are listed
- Click a "✅" or "☐" next to a group member to toggle them as an admin

### 2. Group Member Picker

**Problem:** Manually typing phone numbers like `8801305005526` is error-prone.

**Solution:** Click **"Load Group Members"**. The app calls Baileys' `sock.groupMetadata(selectedSource)`, which returns the real participant list — including their WhatsApp JIDs, admin status, and phone numbers. You just click to select.

```js
const meta = await sock.groupMetadata(groupId);
const participants = meta.participants.map(p => ({
    id: p.id,
    number: p.id.split('@')[0],     // e.g. "8801305005526"
    isAdmin: p.admin === 'admin' || p.admin === 'superadmin'
}));
```

### 3. Phone Number Normalization

**The bug:** When a Bangladesh user saved their number as `01305005526` (local format with leading zero), but WhatsApp sends messages from `8801305005526` (international format), the simple string comparison `admin.includes(sender)` returned `false`. Nothing was forwarded.

**The fix:**

```js
function normalizePhone(num) {
    let n = String(num).replace(/\D/g, '');  // strip non-digits
    if (n.startsWith('+')) n = n.slice(1);   // remove + if present
    if (n.startsWith('0')) n = n.slice(1);   // remove leading 0 for local format
    return n;                                 // e.g. "8801305005526"
}

function isAdmin(senderNum, adminList) {
    const senderCore = normalizePhone(senderNum);
    return adminList.some(admin => {
        const adminCore = normalizePhone(admin);
        if (senderCore === adminCore) return true;
        if (senderCore.length > adminCore.length && senderCore.endsWith(adminCore)) return true;
        if (adminCore.length > senderCore.length && adminCore.endsWith(senderCore)) return true;
        return false;
    });
}
```

This handles:
- `01305005526` → `1305005526`
- `8801305005526` → `8801305005526`
- Suffix matching: if admin is stored as `1305005526` and sender is `8801305005526`, it still matches.

### 4. Full Media Forwarding

Handles all WhatsApp message types explicitly (see **Architecture** above for why `{ forward: msg }` isn't enough):

| Type | Baileys Key | Forward Method |
|---|---|---|
| Text | `conversation`, `extendedTextMessage` | `sock.sendMessage(target, { text })` |
| Image | `imageMessage` | `downloadMediaMessage()` → `{ image: buffer, caption }` |
| Video | `videoMessage` | `downloadMediaMessage()` → `{ video: buffer, caption }` |
| Audio | `audioMessage` | `downloadMediaMessage()` → `{ audio: buffer, ptt }` |
| Document | `documentMessage` | `downloadMediaMessage()` → `{ document: buffer, mimetype, fileName }` |
| Sticker | `stickerMessage` | `downloadMediaMessage()` → `{ sticker: buffer }` |

---

## Common Bugs & Fixes

### Bug 1: Media not forwarding
**Symptom:** Images/videos arrive in target group as empty/broken messages.
**Cause:** `{ forward: msg }` doesn't download media bytes.
**Fix:** Use `downloadMediaMessage()` then re-send with explicit media fields.

### Bug 2: Admin numbers don't match
**Symptom:** Messages from an admin are skipped despite being in `ADMIN_NUMBERS`.
**Cause:** Phone number format mismatch — local `0xxxx` vs international `8xxxxxxxx`.
**Fix:** `normalizePhone()` strips to core digits and uses `endsWith()` suffix matching.

### Bug 3: Server restart loop (PM2 crashes)
**Symptom:** PM2 shows 100+ restarts, dashboard inaccessible, `EADDRINUSE` in logs.
**Cause:** Port 3000 is already bound by a zombie process from a previous crash.
**Fix:**
```bash
pkill -9 -f "web-dashboard"    # Kill all old Node processes
fuser -k 3000/tcp              # Force-free the port
pm2 kill && pm2 start ecosystem.config.js   # PM2 clean start
```

### Bug 4: LWA (Last-Wide-Away) Sender IDs
**Symptom:** Log shows skipped sender like `280641954394179` which doesn't look like any known phone number.
**Cause:** WhatsApp Baileys sometimes sends messages with a LID (Linked Device ID) instead of the phone number JID.
**Fix:** Using `groupMetadata()` and picking from the real participant list guarantees you're using the exact ID string Baileys uses.

---

## Dashboard Screenshots / Usage

### 1. Connect WhatsApp
- Open dashboard URL
- Click **"Show QR Code"**
- Scan with WhatsApp mobile app
- Status turns **green ✅ Connected**

### 2. Select Groups
- Click **"Load Groups"** to refresh the group list
- Click a source group from the **📤 Source Group** list
- Click a target group from the **📥 Target Group** list
- Click **"Save Selection"**

### 3. Configure Forwarding Mode
- Click **"Admin Only"** (orange) or **"All Messages"** (green) to toggle
- If Admin Only, click **"Load Group Members"**
- Click members to toggle them as allowed admins
- Click **"Save Selection"**

---

## PM2 Management

```bash
# Start
pm2 start ecosystem.config.js

# View logs
pm2 logs whatsapp-forwarder

# Restart after code changes
pm2 restart whatsapp-forwarder

# Stop
pm2 stop whatsapp-forwarder

# Monitor
pm2 monit
```

**Note:** `ecosystem.config.js` should have `watch: false` unless you want PM2 to auto-restart whenever files change (can cause restart loops if `config.js` is auto-written).

---

## Environment Variables (Optional)

You can override defaults by setting environment variables before starting:

```bash
export PORT=8080        # Run dashboard on different port
export AUTH_DIR=/tmp/wa-auth   # Store session elsewhere
```

Then edit `web-dashboard.js` top section to use `process.env.PORT || 3000`.

---

## Credits & License

Built with **@whiskeysockets/baileys** — the best actively maintained WhatsApp Web library for Node.js.

MIT License — feel free to fork and modify.
