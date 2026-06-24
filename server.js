const express = require('express');
const http = require('http');
const https = require('https');
const WebSocket = require('ws');
const path = require('path');
const fs = require('fs');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files from 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

// Dynamic HTTP/HTTPS server setup
let server;
let isHttps = false;

const keyPath = path.join(__dirname, 'key.pem');
const certPath = path.join(__dirname, 'cert.pem');

if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
  try {
    const privateKey = fs.readFileSync(keyPath, 'utf8');
    const certificate = fs.readFileSync(certPath, 'utf8');
    const credentials = { key: privateKey, cert: certificate };
    server = https.createServer(credentials, app);
    isHttps = true;
    console.log('SSL certificates found. Running in HTTPS mode.');
  } catch (err) {
    console.error('Error loading SSL certificates. Falling back to HTTP:', err);
    server = http.createServer(app);
  }
} else {
  console.log('No SSL certificates found (key.pem/cert.pem). Running in HTTP mode.');
  server = http.createServer(app);
}

const wss = new WebSocket.Server({ server });

// In-memory store for active sessions
// Map: sessionId -> { senders: Set(ws), receivers: Set(ws) }
const sessions = new Map();

// Helper to generate a unique 4-digit session ID
function generateSessionId() {
  let id;
  do {
    id = Math.floor(1000 + Math.random() * 9000).toString();
  } while (sessions.has(id));
  return id;
}

// Helper to detect local network IPv4 address
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const devName in interfaces) {
    const iface = interfaces[devName];
    for (let i = 0; i < iface.length; i++) {
      const alias = iface[i];
      if (alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) {
        return alias.address;
      }
    }
  }
  return 'localhost';
}

// HTTP API to request a new session ID
app.get('/api/session/new', (req, res) => {
  const sessionId = generateSessionId();
  sessions.set(sessionId, { senders: new Set(), receivers: new Set() });
  console.log(`Created new session: ${sessionId}`);
  res.json({ sessionId, localIp: getLocalIp() });
});

// WebSocket connection handler
wss.on('connection', (ws) => {
  let currentSessionId = null;
  let currentRole = null;

  console.log('New WebSocket connection established.');

  ws.on('message', (messageString) => {
    try {
      const message = JSON.parse(messageString);
      
      switch (message.type) {
        case 'join':
          const { role, sessionId } = message;
          if (!sessionId) {
            ws.send(JSON.stringify({ type: 'error', message: 'Session ID is required.' }));
            return;
          }
          
          // Ensure session exists
          if (!sessions.has(sessionId)) {
            sessions.set(sessionId, { senders: new Set(), receivers: new Set() });
          }

          const session = sessions.get(sessionId);
          currentSessionId = sessionId;
          currentRole = role;

          if (role === 'sender') {
            session.senders.add(ws);
            console.log(`Sender joined session ${sessionId}. Active senders: ${session.senders.size}`);
          } else if (role === 'receiver') {
            session.receivers.add(ws);
            console.log(`Receiver joined session ${sessionId}. Active receivers: ${session.receivers.size}`);
          }

          ws.send(JSON.stringify({ type: 'joined', role, sessionId }));
          break;

        case 'telemetry':
          // Forward telemetry from sender to all receivers in the session
          if (currentSessionId && currentRole === 'sender') {
            const activeSession = sessions.get(currentSessionId);
            if (activeSession) {
              const broadcastData = JSON.stringify({
                type: 'telemetry',
                data: message.data,
                timestamp: Date.now()
              });
              activeSession.receivers.forEach((receiverWs) => {
                if (receiverWs.readyState === WebSocket.OPEN) {
                  receiverWs.send(broadcastData);
                }
              });
            }
          }
          break;

        case 'control':
          // Bidirectional controls (start, pause, stop, reset)
          // Send control messages to all other devices in the session
          if (currentSessionId) {
            const activeSession = sessions.get(currentSessionId);
            if (activeSession) {
              const controlData = JSON.stringify({
                type: 'control',
                action: message.action,
                source: currentRole,
                timestamp: Date.now()
              });
              
              const targetSet = currentRole === 'sender' ? activeSession.receivers : activeSession.senders;
              targetSet.forEach((targetWs) => {
                if (targetWs.readyState === WebSocket.OPEN) {
                  targetWs.send(controlData);
                }
              });
              console.log(`Session ${currentSessionId}: Forwarded control '${message.action}' from ${currentRole}`);
            }
          }
          break;

        case 'ping':
          ws.send(JSON.stringify({ type: 'pong' }));
          break;

        default:
          console.warn(`Unknown message type: ${message.type}`);
      }
    } catch (err) {
      console.error('Error handling WebSocket message:', err);
      ws.send(JSON.stringify({ type: 'error', message: 'Invalid message format.' }));
    }
  });

  ws.on('close', () => {
    console.log(`Connection closed for session ${currentSessionId} (${currentRole})`);
    if (currentSessionId && sessions.has(currentSessionId)) {
      const session = sessions.get(currentSessionId);
      
      if (currentRole === 'sender') {
        session.senders.delete(ws);
      } else if (currentRole === 'receiver') {
        session.receivers.delete(ws);
      }

      // If session is completely empty, clean it up after a small delay (to allow reconnection)
      setTimeout(() => {
        const checkSession = sessions.get(currentSessionId);
        if (checkSession && checkSession.senders.size === 0 && checkSession.receivers.size === 0) {
          sessions.delete(currentSessionId);
          console.log(`Cleaned up empty session: ${currentSessionId}`);
        }
      }, 5000);
    }
  });
});

// Fallback routing to index.html for undefined frontend routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
  console.log(`==================================================`);
  console.log(`Bike Computer Mirror Server running on port ${PORT}`);
  console.log(`Open http://localhost:${PORT} to start`);
  console.log(`==================================================`);
});
