const { default: makeWASocket, DisconnectReason, useMultiFileAuthState, fetchLatestBaileysVersion, downloadMediaMessage } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const pino = require('pino');
const fs = require('fs');
const http = require('http');
const url = require('url');

const logger = pino({ level: 'silent' });
const AUTH_FOLDER = './auth_info';
const CONFIG_FILE = './config.js';

let currentQRSvg = null;
let isConnected = false;
let sock = null;
let groupsList = [];
let groupParticipants = {};
let selectedSource = null;
let selectedTarget = null;
let forwardAdminOnly = false;
let adminNumbers = [];
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 5000;
let isConnecting = false;
let connectionLoop = null;

function normalizePhone(num) {
    let n = String(num).replace(/\D/g, '');
    if (n.startsWith('+')) n = n.slice(1);
    if (n.startsWith('0')) n = n.slice(1);
    return n;
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

function loadConfig() {
    delete require.cache[require.resolve(CONFIG_FILE)];
    return require(CONFIG_FILE);
}

function saveConfig(sourceId, targetId, adminOnly, admins) {
    const src = sourceId !== undefined ? sourceId : selectedSource || '';
    const tgt = targetId !== undefined ? targetId : selectedTarget || '';
    const aOnly = adminOnly !== undefined ? adminOnly : forwardAdminOnly;
    const adms = admins !== undefined ? admins : adminNumbers;
    const content = `module.exports = {
    SOURCE_GROUP_ID: '${src}',
    TARGET_GROUP_ID: '${tgt}',
    FORWARD_ALL_MESSAGES: ${!aOnly},
    FORWARD_ADMIN_ONLY: ${aOnly},
    ADMIN_NUMBERS: [${adms.map(n => `'${n}'`).join(', ')}],
};
`;
    fs.writeFileSync(CONFIG_FILE, content);
}

function clearAuthFolder() {
    try {
        if (fs.existsSync(AUTH_FOLDER)) {
            fs.rmSync(AUTH_FOLDER, { recursive: true, force: true });
        }
        fs.mkdirSync(AUTH_FOLDER, { recursive: true });
    } catch (err) {
        console.error('Auth clear error:', err.message);
    }
}

function renderHTML(query) {
    const showQR = query.qr === '1';
    const refreshMeta = showQR && !isConnected ? '<meta http-equiv="refresh" content="8">' : '';

    let statusHTML = '';
    if (isConnected) {
        statusHTML = '<p style="color:green;font-weight:bold">✅ Connected</p>';
    } else {
        statusHTML = '<p style="color:red;font-weight:bold">❌ Not Connected</p>';
    }

    let qrHTML = '';
    if (isConnected) {
        qrHTML = '<p>WhatsApp is connected.</p>';
    } else if (showQR) {
        if (currentQRSvg) {
            qrHTML = '<div style="background:#fff;border:2px solid #ddd;border-radius:8px;padding:12px;display:inline-block">' +
                '<div style="width:240px;height:240px">' + currentQRSvg + '</div></div>' +
                '<p style="color:#666;font-size:13px">WhatsApp → Settings → Linked Devices → Link a Device</p>';
        } else {
            qrHTML = '<p style="color:#888">Generating QR...</p>';
        }
        qrHTML += '<p><a href="/?qr=0" style="color:#2563eb">Hide QR</a></p>';
    } else {
        qrHTML = '<p><a href="/?qr=1" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:15px">📱 Show QR Code</a></p>';
    }

    let groupsHTML = '';
    if (isConnected) {
        groupsHTML += '<div class="card"><h2>👥 Groups</h2>';
        groupsHTML += '<p><a href="/?action=refresh" style="display:inline-block;background:#4b5563;color:#fff;padding:8px 16px;border-radius:6px;text-decoration:none;font-size:14px">🔄 Load Groups</a></p>';

        if (groupsList.length) {
            groupsHTML += '<div style="margin-bottom:16px"><h3 style="font-size:13px;color:#2563eb;margin:0 0 8px">📤 Source Group (click one)</h3>';
            groupsList.forEach(g => {
                let style = 'border:1px solid #ddd;border-radius:6px;padding:10px;margin:4px 0;text-decoration:none;color:#333;display:block;';
                if (selectedSource === g.id) style += 'background:#eff6ff;border-color:#2563eb;';
                groupsHTML += '<a href="/?action=setsrc&id=' + encodeURIComponent(g.id) + '" style="' + style + '">' +
                    '<div style="font-weight:600">' + escapeHtml(g.name) + '</div>' +
                    '<div style="font-size:11px;color:#888">' + escapeHtml(g.id) + '</div></a>';
            });
            groupsHTML += '</div>';

            groupsHTML += '<div style="margin-bottom:16px"><h3 style="font-size:13px;color:#16a34a;margin:0 0 8px">📥 Target Group (click one)</h3>';
            groupsList.forEach(g => {
                let style = 'border:1px solid #ddd;border-radius:6px;padding:10px;margin:4px 0;text-decoration:none;color:#333;display:block;';
                if (selectedTarget === g.id) style += 'background:#f0fdf4;border-color:#16a34a;';
                groupsHTML += '<a href="/?action=settgt&id=' + encodeURIComponent(g.id) + '" style="' + style + '">' +
                    '<div style="font-weight:600">' + escapeHtml(g.name) + '</div>' +
                    '<div style="font-size:11px;color:#888">' + escapeHtml(g.id) + '</div></a>';
            });
            groupsHTML += '</div>';

            const srcName = groupsList.find(g => g.id === selectedSource)?.name || selectedSource || 'None';
            const tgtName = groupsList.find(g => g.id === selectedTarget)?.name || selectedTarget || 'None';
            groupsHTML += '<p style="font-size:13px;padding:8px;background:#f9f9f9;border-radius:6px">' +
                '📤 <b>' + escapeHtml(srcName) + '</b> → 📥 <b>' + escapeHtml(tgtName) + '</b></p>';

            if (selectedSource && selectedTarget && selectedSource !== selectedTarget) {
                groupsHTML += '<p style="margin-top:10px"><a href="/?action=save" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 24px;border-radius:6px;text-decoration:none;font-size:15px;font-weight:600">💾 Save Selection</a></p>';
            }
        } else {
            groupsHTML += '<p style="color:#888">No groups loaded. Click Load Groups.</p>';
        }
        groupsHTML += '</div>';
    }

    const srcName = groupsList.find(g => g.id === selectedSource)?.name || selectedSource || 'Not set';
    const tgtName = groupsList.find(g => g.id === selectedTarget)?.name || selectedTarget || 'Not set';

    const modeLabel = forwardAdminOnly ? 'Admin Only' : 'All Messages';
    const modeColor = forwardAdminOnly ? '#f59e0b' : '#16a34a';
    const modeSwitchStyle = `display:inline-block;padding:4px 12px;border-radius:12px;font-size:12px;font-weight:600;color:#fff;background:${modeColor};text-decoration:none;`;

    let adminsHTML = '';
    if (forwardAdminOnly) {
        adminsHTML += '<div style="margin-top:12px;padding-top:12px;border-top:1px solid #eee">';

        if (adminNumbers.length) {
            adminsHTML += '<p style="margin:0 0 6px;font-size:12px;color:#666;font-weight:600">✅ Selected admins:</p>';
            adminNumbers.forEach(num => {
                adminsHTML += '<div style="display:flex;justify-content:space-between;align-items:center;padding:4px 0;font-size:13px">' +
                    '<span>📱 ' + escapeHtml(num) + '</span>' +
                    '<a href="/?action=rmadmin&num=' + encodeURIComponent(num) + '" style="color:#dc2626;font-size:12px">Remove</a></div>';
            });
        } else {
            adminsHTML += '<p style="margin:0;font-size:12px;color:#888">No admins selected yet.</p>';
        }

        const participants = selectedSource && groupParticipants[selectedSource];
        if (participants && participants.length) {
            adminsHTML += '<div style="margin-top:12px">';
            adminsHTML += '<p style="margin:0 0 6px;font-size:12px;color:#666;font-weight:600">👥 Pick from source group members:</p>';
            participants.forEach(p => {
                const selected = isAdmin(p.number, adminNumbers);
                const status = selected ? '✅' : '☐';
                const style = selected
                    ? 'background:#f0fdf4;border-color:#16a34a;color:#166534;'
                    : 'background:#fff;border-color:#ddd;color:#333;';
                adminsHTML += '<a href="/?action=addadminfromgroup&num=' + encodeURIComponent(p.id) + '" style="display:block;border:1px solid #ddd;border-radius:6px;padding:8px 10px;margin:4px 0;text-decoration:none;font-size:13px;' + style + '">' +
                    status + ' <b>' + escapeHtml(p.number) + '</b>' +
                    (p.isAdmin ? ' <span style="color:#f59e0b;font-size:11px">👑 Group Admin</span>' : '') +
                    '</a>';
            });
            adminsHTML += '</div>';
        } else if (selectedSource) {
            adminsHTML += '<p style="margin-top:10px"><a href="/?action=loadparticipants" style="display:inline-block;background:#4b5563;color:#fff;padding:6px 14px;border-radius:6px;text-decoration:none;font-size:13px">🔄 Load Group Members</a></p>';
        }

        adminsHTML += '<form method="GET" action="/" style="display:flex;gap:6px;margin-top:10px">' +
            '<input type="hidden" name="action" value="addadmin" />' +
            '<input type="text" name="num" placeholder="Or type number manually" style="flex:1;padding:8px 10px;border:1px solid #ddd;border-radius:6px;font-size:14px" />' +
            '<button type="submit" style="padding:8px 14px;background:#2563eb;color:#fff;border:none;border-radius:6px;font-size:13px;cursor:pointer">Add</button>' +
            '</form>';

        adminsHTML += '</div>';
    }

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
${refreshMeta}
<title>WhatsApp Forwarder</title>
<style>
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;color:#333;max-width:600px;margin:0 auto;padding:16px;line-height:1.5}
.card{background:#fff;border:1px solid #ddd;border-radius:8px;padding:16px;margin-bottom:16px}
h1{font-size:20px;margin:0 0 16px}
h2{font-size:14px;text-transform:uppercase;color:#666;margin:0 0 10px;letter-spacing:.5px}
.row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #eee}
</style>
</head>
<body>
<h1>📠 WhatsApp Forwarder</h1>

<div class="card">
<h2>Connection</h2>
${statusHTML}
${qrHTML}
${!isConnected ? '<p><a href="/?action=clear" style="color:#dc2626;font-size:13px">🗑️ Clear Session</a></p>' : ''}
</div>

${groupsHTML}

<div class="card">
<h2>Config</h2>
<div class="row"><span>Source</span><span>${escapeHtml(srcName)}</span></div>
<div class="row"><span>Target</span><span>${escapeHtml(tgtName)}</span></div>
<div class="row" style="border-bottom:none;padding-top:8px">
    <span>Forwarding Mode</span>
    <a href="/?action=togglemode" style="${modeSwitchStyle}">${escapeHtml(modeLabel)}</a>
</div>
${adminsHTML}
</div>

</body>
</html>`;
}

function escapeHtml(text) {
    if (!text) return '';
    return String(text).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    const query = parsedUrl.query;

    if (query.action === 'refresh' && isConnected && sock) {
        try {
            const groups = await sock.groupFetchAllParticipating();
            groupsList = Object.entries(groups).map(([id, group]) => ({
                id, name: group.subject, participants: group.participants?.length || 0
            }));
        } catch (e) {}
        res.writeHead(302, { Location: '/' });
        res.end();
        return;
    }

    if (query.action === 'loadparticipants' && selectedSource && isConnected && sock) {
        try {
            const meta = await sock.groupMetadata(selectedSource);
            const participants = (meta.participants || []).map(p => {
                const num = p.id.split('@')[0];
                return { id: p.id, number: num, isAdmin: p.admin === 'admin' || p.admin === 'superadmin' };
            });
            groupParticipants[selectedSource] = participants;
            console.log('👥 Participants loaded:', participants.length, 'for', selectedSource);
        } catch (err) {
            console.error('Participants error:', err.message);
        }
        res.writeHead(302, { Location: '/' });
        res.end();
        return;
    }

    if (query.action === 'setsrc' && query.id) {
        selectedSource = query.id;
        res.writeHead(302, { Location: '/' });
        res.end();
        return;
    }

    if (query.action === 'settgt' && query.id) {
        selectedTarget = query.id;
        res.writeHead(302, { Location: '/' });
        res.end();
        return;
    }

    if (query.action === 'save' && selectedSource && selectedTarget) {
        saveConfig(selectedSource, selectedTarget);
        res.writeHead(302, { Location: '/' });
        res.end();
        return;
    }

    if (query.action === 'togglemode') {
        forwardAdminOnly = !forwardAdminOnly;
        saveConfig();
        res.writeHead(302, { Location: '/' });
        res.end();
        return;
    }

    if (query.action === 'addadmin' && query.num) {
        const num = String(query.num).replace(/\D/g, '');
        if (num) {
            const norm = normalizePhone(num);
            const already = adminNumbers.some(a => normalizePhone(a) === norm);
            if (!already) {
                adminNumbers.push(num);
                saveConfig();
            }
        }
        res.writeHead(302, { Location: '/' });
        res.end();
        return;
    }

    if (query.action === 'addadminfromgroup' && query.num) {
        const num = String(query.num).replace(/\D/g, '');
        if (num) {
            const norm = normalizePhone(num);
            const already = adminNumbers.some(a => normalizePhone(a) === norm);
            if (!already) {
                adminNumbers.push(num);
                saveConfig();
                console.log('✅ Admin added from group:', num);
            }
        }
        res.writeHead(302, { Location: '/' });
        res.end();
        return;
    }

    if (query.action === 'rmadmin' && query.num) {
        adminNumbers = adminNumbers.filter(n => n !== query.num);
        saveConfig();
        res.writeHead(302, { Location: '/' });
        res.end();
        return;
    }

    if (query.action === 'clear') {
        clearAuthFolder();
        currentQRSvg = null;
        isConnected = false;
        reconnectAttempts = 0;
        groupParticipants = {};
        if (sock) { try { sock.end(); } catch (e) {} sock = null; }
        if (connectionLoop) clearTimeout(connectionLoop);
        setTimeout(() => startConnection(), 500);
        res.writeHead(302, { Location: '/' });
        res.end();
        return;
    }

    if (parsedUrl.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store, no-cache, must-revalidate' });
        res.end(renderHTML(query));
        return;
    }

    if (parsedUrl.pathname === '/api/state') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ connected: isConnected, groups: groupsList }));
        return;
    }

    res.writeHead(404);
    res.end('Not found');
});

server.listen(3000, '0.0.0.0', () => {
    console.log('WEB_DASHBOARD_READY on port 3000');
});

async function startConnection() {
    if (isConnecting) return;
    isConnecting = true;
    try {
        const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER);
        const { version } = await fetchLatestBaileysVersion();
        const config = loadConfig();
        selectedSource = config.SOURCE_GROUP_ID;
        selectedTarget = config.TARGET_GROUP_ID;
        forwardAdminOnly = config.FORWARD_ADMIN_ONLY || false;
        adminNumbers = config.ADMIN_NUMBERS || [];

        sock = makeWASocket({
            version,
            logger,
            printQRInTerminal: false,
            auth: state,
            browser: ['Chrome (Linux)', '', ''],
            markOnlineOnConnect: true,
            syncFullHistory: false,
        });

        sock.ev.on('creds.update', saveCreds);

        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect, qr } = update;

            if (qr) {
                try {
                    currentQRSvg = await QRCode.toString(qr, { type: 'svg', width: 240, margin: 1 });
                } catch (err) {
                    console.error('QR gen error:', err.message);
                }
            }

            if (connection === 'open') {
                isConnected = true;
                reconnectAttempts = 0;
                currentQRSvg = null;
                try {
                    const groups = await sock.groupFetchAllParticipating();
                    groupsList = Object.entries(groups).map(([id, group]) => ({
                        id, name: group.subject, participants: group.participants?.length || 0
                    }));
                    console.log('📋 Groups loaded:', groupsList.length);
                } catch (err) {
                    console.error('Groups error:', err.message);
                }
            }

            if (connection === 'close') {
                isConnected = false;
                currentQRSvg = null;
                const statusCode = lastDisconnect?.error?.output?.statusCode;
                const msg = lastDisconnect?.error?.message || '';
                console.log('❌ Connection closed:', statusCode, msg);

                if (statusCode === 401 || msg.includes('401') || msg.includes('logged out')) {
                    clearAuthFolder();
                    reconnectAttempts = 0;
                    if (connectionLoop) clearTimeout(connectionLoop);
                    connectionLoop = setTimeout(() => startConnection(), 2000);
                    isConnecting = false;
                    return;
                }

                if (statusCode !== DisconnectReason.loggedOut) {
                    reconnectAttempts++;
                    if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
                        console.log(`🔄 Reconnecting... attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS}`);
                        if (connectionLoop) clearTimeout(connectionLoop);
                        connectionLoop = setTimeout(() => startConnection(), RECONNECT_DELAY_MS);
                    } else {
                        console.log('❌ Max reconnection attempts reached.');
                    }
                }
            }
        });

        sock.ev.on('messages.upsert', async (m) => {
            if (!selectedSource || !selectedTarget || !isConnected) return;
            for (const msg of m.messages) {
                if (msg.key.remoteJid !== selectedSource) continue;
                if (msg.key.fromMe) continue;

                if (forwardAdminOnly) {
                    const sender = msg.key.participant || msg.key.remoteJid;
                    const senderNum = sender.split('@')[0];
                    if (!isAdmin(senderNum, adminNumbers)) {
                        console.log('🚫 Skipped (not admin):', senderNum, 'admins:', adminNumbers);
                        continue;
                    }
                }

                try {
                    const type = Object.keys(msg.message || {})[0];

                    if (type === 'conversation' || type === 'extendedTextMessage') {
                        const text = msg.message?.conversation || msg.message?.extendedTextMessage?.text || '';
                        if (text) {
                            await sock.sendMessage(selectedTarget, { text });
                            console.log('✅ Forwarded text');
                        }
                    } else if (type === 'imageMessage') {
                        const buffer = await downloadMediaMessage(msg, 'buffer');
                        await sock.sendMessage(selectedTarget, { image: buffer, caption: msg.message.imageMessage?.caption || '' });
                        console.log('✅ Forwarded image');
                    } else if (type === 'videoMessage') {
                        const buffer = await downloadMediaMessage(msg, 'buffer');
                        await sock.sendMessage(selectedTarget, { video: buffer, caption: msg.message.videoMessage?.caption || '' });
                        console.log('✅ Forwarded video');
                    } else if (type === 'audioMessage') {
                        const buffer = await downloadMediaMessage(msg, 'buffer');
                        await sock.sendMessage(selectedTarget, { audio: buffer, ptt: msg.message.audioMessage?.ptt || false });
                        console.log('✅ Forwarded audio');
                    } else if (type === 'documentMessage') {
                        const buffer = await downloadMediaMessage(msg, 'buffer');
                        await sock.sendMessage(selectedTarget, { document: buffer, mimetype: msg.message.documentMessage?.mimetype, fileName: msg.message.documentMessage?.fileName || 'file' });
                        console.log('✅ Forwarded document');
                    } else if (type === 'stickerMessage') {
                        const buffer = await downloadMediaMessage(msg, 'buffer');
                        await sock.sendMessage(selectedTarget, { sticker: buffer });
                        console.log('✅ Forwarded sticker');
                    } else {
                        await sock.sendMessage(selectedTarget, { forward: msg });
                        console.log('✅ Forwarded unknown type:', type);
                    }
                } catch (err) {
                    console.error('Forward error:', err.message);
                }
            }
        });
    } catch (err) {
        console.error('Start connection error:', err.message);
        reconnectAttempts++;
        if (reconnectAttempts <= MAX_RECONNECT_ATTEMPTS) {
            if (connectionLoop) clearTimeout(connectionLoop);
            connectionLoop = setTimeout(() => startConnection(), RECONNECT_DELAY_MS);
        }
    } finally {
        isConnecting = false;
    }
}

startConnection();
