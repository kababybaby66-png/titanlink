/**
 * TitanLink Signaling Server
 * A lightweight WebSocket server for WebRTC signaling
 * 
 * Deploy this to Glitch, Heroku, Railway, Render, or any Node.js hosting
 * 
 * Usage:
 *   npm install
 *   npm start
 * 
 * Environment Variables:
 *   PORT - Server port (default: 3001)
 */

const express = require('express');
const { createServer } = require('http');
const { WebSocketServer } = require('ws');
const crypto = require('crypto');

const app = express();
const httpServer = createServer(app);

// Store active sessions
const sessions = new Map();
// Store WebSocket connections
const connections = new Map();

// Health check endpoint
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        name: 'TitanLink Signaling Server',
        activeSessions: sessions.size,
        activeConnections: connections.size,
    });
});

// Create WebSocket server
const wss = new WebSocketServer({ server: httpServer });

// Heartbeat function
function heartbeat() {
    this.isAlive = true;
}

wss.on('connection', (ws) => {
    const connId = crypto.randomUUID().substring(0, 8);
    console.log('Client connected:', connId);

    // Setup heartbeat
    ws.isAlive = true;
    ws.on('pong', heartbeat);

    connections.set(connId, {
        ws,
        session: null,
        role: null,
        peerId: '',
    });

    ws.on('message', (data) => {
        try {
            const message = JSON.parse(data.toString());
            // console.log('[WS] Message from', connId, ':', message.type);

            const conn = connections.get(connId);
            if (!conn) return;

            if (message.type === 'create-session') {
                const sessionCode = message.sessionCode;
                const hostId = message.hostId;

                if (!sessionCode || !hostId) {
                    ws.send(JSON.stringify({ type: 'error', data: 'Missing sessionCode or hostId' }));
                    return;
                }

                if (sessions.has(sessionCode)) {
                    ws.send(JSON.stringify({ type: 'error', data: 'Session code already in use' }));
                    return;
                }

                sessions.set(sessionCode, {
                    hostId,
                    hostConnId: connId,
                    clients: new Map(),
                    createdAt: Date.now(),
                });

                conn.session = sessionCode;
                conn.role = 'host';
                conn.peerId = hostId;

                console.log('Session created:', sessionCode, 'by host:', hostId);
                ws.send(JSON.stringify({ type: 'session-created' }));
            }
            else if (message.type === 'join-session') {
                const sessionCode = message.sessionCode;
                const clientId = message.clientId;

                if (!sessionCode || !clientId) return;

                const session = sessions.get(sessionCode);
                if (!session) {
                    ws.send(JSON.stringify({ type: 'session-not-found' }));
                    return;
                }

                session.clients.set(clientId, {
                    connId: connId,
                    joinedAt: Date.now(),
                });

                conn.session = sessionCode;
                conn.role = 'client';
                conn.peerId = clientId;

                console.log('Client', clientId, 'joined session:', sessionCode);
                ws.send(JSON.stringify({ type: 'session-joined', data: { hostId: session.hostId } }));

                // Notify host
                const hostConn = connections.get(session.hostConnId);
                if (hostConn && hostConn.ws.readyState === 1) {
                    hostConn.ws.send(JSON.stringify({ type: 'peer-joined', data: { peerId: clientId } }));
                }
            }
            else if (message.type === 'signal') {
                const sessionCode = message.sessionCode;
                if (!sessionCode) return;

                const session = sessions.get(sessionCode);
                if (!session) return;

                const response = JSON.stringify({
                    type: 'signal',
                    data: { from: conn.peerId, to: message.to, payload: message.payload }
                });

                if (message.to) {
                    // Send to specific peer
                    if (message.to === session.hostId) {
                        const hostConn = connections.get(session.hostConnId);
                        if (hostConn && hostConn.ws.readyState === 1) {
                            hostConn.ws.send(response);
                        }
                    } else {
                        const client = session.clients.get(message.to);
                        if (client) {
                            const targetConn = connections.get(client.connId);
                            if (targetConn && targetConn.ws.readyState === 1) {
                                targetConn.ws.send(response);
                            }
                        }
                    }
                } else {
                    // Broadcast to all in session
                    connections.forEach((c) => {
                        if (c.session === sessionCode && c.ws.readyState === 1 && c.peerId !== conn.peerId) {
                            c.ws.send(response);
                        }
                    });
                }
            }
            else if (message.type === 'leave-session') {
                handleDisconnect(connId);
            }
        } catch (e) {
            console.error('Error parsing message:', e);
        }
    });

    ws.on('close', () => {
        console.log('Client disconnected:', connId);
        handleDisconnect(connId);
    });

    ws.on('error', (err) => {
        console.error('WebSocket error for', connId, ':', err.message);
        handleDisconnect(connId);
    });
});

// Ping interval to terminate dead connections
const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
        if (ws.isAlive === false) {
            console.log('Terminating dead connection');
            return ws.terminate();
        }

        ws.isAlive = false;
        ws.ping();
    });
}, 30000);

wss.on('close', () => {
    clearInterval(interval);
});

function handleDisconnect(connId) {
    const conn = connections.get(connId);
    if (!conn) return;

    if (conn.session) {
        const session = sessions.get(conn.session);
        if (session) {
            if (conn.role === 'host') {
                // Notify all clients that host left
                connections.forEach((c) => {
                    if (c.session === conn.session && c.ws.readyState === 1) {
                        c.ws.send(JSON.stringify({ type: 'host-left' }));
                    }
                });
                sessions.delete(conn.session);
                console.log('Session destroyed:', conn.session);
            } else {
                // Client left - notify host
                session.clients.delete(conn.peerId);
                const hostConn = connections.get(session.hostConnId);
                if (hostConn && hostConn.ws.readyState === 1) {
                    hostConn.ws.send(JSON.stringify({ type: 'peer-left', data: { peerId: conn.peerId } }));
                }
            }
        }
    }

    connections.delete(connId);
}

// Cleanup stale sessions (older than 2 hours)
setInterval(() => {
    const now = Date.now();
    const maxAge = 2 * 60 * 60 * 1000; // 2 hours

    sessions.forEach((session, code) => {
        if (now - session.createdAt > maxAge) {
            sessions.delete(code);
            console.log('Cleaned up stale session:', code);
        }
    });
}, 60 * 1000);

const PORT = process.env.PORT || 3001;

httpServer.listen(PORT, () => {
    console.log(`TitanLink Signaling Server running on port ${PORT}`);
    console.log(`WebSocket endpoint: ws://localhost:${PORT}`);
});
