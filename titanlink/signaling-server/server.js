/**
 * TitanLink Signaling Server
 * A lightweight Socket.IO server for WebRTC signaling
 * 
 * Deploy this to Glitch, Heroku, Railway, or any Node.js hosting
 * 
 * Usage:
 *   npm install
 *   npm start
 */

const express = require('express');
const { createServer } = require('http');
const { Server } = require('socket.io');

const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer, {
    cors: {
        origin: '*',
        methods: ['GET', 'POST'],
    },
    transports: ['websocket', 'polling'],
});

// Store active sessions
const sessions = new Map();

// Health check endpoint
app.get('/', (req, res) => {
    res.json({
        status: 'ok',
        name: 'TitanLink Signaling Server',
        activeSessions: sessions.size,
    });
});

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    let currentSession = null;
    let currentRole = null;

    // Host creates a session
    socket.on('create-session', ({ sessionCode, hostId }) => {
        console.log('Creating session:', sessionCode, 'by host:', hostId);

        // Check if session already exists
        if (sessions.has(sessionCode)) {
            socket.emit('error', 'Session code already in use');
            return;
        }

        // Create session
        sessions.set(sessionCode, {
            hostId,
            hostSocketId: socket.id,
            clients: new Map(),
            createdAt: Date.now(),
        });

        currentSession = sessionCode;
        currentRole = 'host';

        socket.join(sessionCode);
        socket.emit('session-created');
    });

    // Client joins a session
    socket.on('join-session', ({ sessionCode, clientId }) => {
        console.log('Joining session:', sessionCode, 'by client:', clientId);

        const session = sessions.get(sessionCode);

        if (!session) {
            socket.emit('session-not-found');
            return;
        }

        // Add client to session
        session.clients.set(clientId, {
            socketId: socket.id,
            joinedAt: Date.now(),
        });

        currentSession = sessionCode;
        currentRole = 'client';

        socket.join(sessionCode);
        socket.emit('session-joined', { hostId: session.hostId });

        // Notify host that a peer joined
        io.to(session.hostSocketId).emit('peer-joined', {
            peerId: clientId,
        });
    });

    // WebRTC signaling
    socket.on('signal', (message) => {
        const session = sessions.get(message.sessionCode);
        if (!session) return;

        // Forward signal to the target peer
        if (message.to) {
            // Find target socket
            let targetSocket = null;

            if (message.to === session.hostId) {
                targetSocket = session.hostSocketId;
            } else {
                const client = session.clients.get(message.to);
                if (client) {
                    targetSocket = client.socketId;
                }
            }

            if (targetSocket) {
                io.to(targetSocket).emit('signal', message);
            }
        } else {
            // Broadcast to all other peers in session
            socket.to(message.sessionCode).emit('signal', message);
        }
    });

    // Leave session
    socket.on('leave-session', ({ sessionCode }) => {
        handleLeave(socket, sessionCode);
    });

    // Handle disconnect
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);

        if (currentSession) {
            handleLeave(socket, currentSession);
        }
    });

    function handleLeave(socket, sessionCode) {
        const session = sessions.get(sessionCode);
        if (!session) return;

        if (currentRole === 'host') {
            // Host left - notify all clients and destroy session
            socket.to(sessionCode).emit('host-left');
            sessions.delete(sessionCode);
            console.log('Session destroyed:', sessionCode);
        } else {
            // Client left - notify host and remove from session
            session.clients.forEach((client, clientId) => {
                if (client.socketId === socket.id) {
                    session.clients.delete(clientId);
                    io.to(session.hostSocketId).emit('peer-left', { peerId: clientId });
                }
            });
        }

        socket.leave(sessionCode);
        currentSession = null;
        currentRole = null;
    }
});

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
});
