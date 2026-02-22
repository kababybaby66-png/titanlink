/**
 * TitanLink Signaling Server — HTTP REST Edition
 * No WebSocket dependency. Pure HTTP polling-based signaling.
 *
 * API:
 *   POST /session          - Host creates a session
 *   POST /session/:code/join  - Client joins a session, gets back sessionId
 *   GET  /session/:code    - Host polls for events (client joined/left)
 *   DELETE /session/:code  - Host closes session
 *
 * Deploy on any Node.js host (Railway, Render, Fly.io, etc.)
 *
 * Environment Variables:
 *   PORT - Server port (default: 3001)
 */

const express = require('express');
const crypto = require('crypto');

const app = express();

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Allow any origin (Electron renderer, Vite dev server, etc.)
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});

app.use(express.json());

// Map of sessionCode -> session object
const sessions = new Map();

// Auto-cleanup stale sessions every 60s
const SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours
setInterval(() => {
    const now = Date.now();
    for (const [code, session] of sessions) {
        if (now - session.createdAt > SESSION_MAX_AGE_MS) {
            sessions.delete(code);
            console.log('[Cleanup] Removed stale session:', code);
        }
    }
}, 60_000);

// ─── Health Check ────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
    res.json({
        status: 'ok',
        name: 'TitanLink Signaling Server (HTTP)',
        activeSessions: sessions.size,
    });
});

// ─── POST /session ────────────────────────────────────────────────────────────
// Host registers a new session.
// Body: { sessionCode, sessionId, hostId }
// Returns: 200 { ok: true } | 409 { error: 'Session code already in use' }
app.post('/session', (req, res) => {
    const { sessionCode, sessionId, hostId } = req.body;

    if (!sessionCode || !sessionId || !hostId) {
        return res.status(400).json({ error: 'Missing sessionCode, sessionId, or hostId' });
    }

    if (sessions.has(sessionCode)) {
        return res.status(409).json({ error: 'Session code already in use' });
    }

    sessions.set(sessionCode, {
        hostId,
        sessionId,
        clients: [],       // Array of { clientId, joinedAt }
        hostPollSince: 0,  // Timestamp: host only gets events newer than this
        createdAt: Date.now(),
        closedAt: null,
    });

    console.log('[Session] Created:', sessionCode, 'by host:', hostId);
    res.json({ ok: true });
});

// ─── POST /session/:code/join ─────────────────────────────────────────────────
// Client joins a session.
// Body: { clientId }
// Returns: 200 { sessionId, hostId } | 404 { error: 'Session not found' }
app.post('/session/:code/join', (req, res) => {
    const sessionCode = req.params.code.toUpperCase();
    const { clientId } = req.body;

    if (!clientId) {
        return res.status(400).json({ error: 'Missing clientId' });
    }

    const session = sessions.get(sessionCode);
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    session.clients.push({ clientId, joinedAt: Date.now() });
    console.log('[Session] Client joined:', clientId, '->', sessionCode);

    res.json({
        sessionId: session.sessionId,
        hostId: session.hostId,
    });
});

// ─── GET /session/:code ───────────────────────────────────────────────────────
// Host polls for new events (client joins).
// Query: ?since=<timestamp>  (only return events newer than this)
// Returns: { events: [{ type, data, timestamp }] }
app.get('/session/:code', (req, res) => {
    const sessionCode = req.params.code.toUpperCase();
    const since = parseInt(req.query.since || '0', 10);

    const session = sessions.get(sessionCode);
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    const newClients = session.clients.filter(c => c.joinedAt > since);
    const events = newClients.map(c => ({
        type: 'peer-joined',
        data: { peerId: c.clientId, clientId: c.clientId },
        timestamp: c.joinedAt,
    }));

    res.json({ events });
});

// ─── DELETE /session/:code ────────────────────────────────────────────────────
// Host closes the session.
app.delete('/session/:code', (req, res) => {
    const sessionCode = req.params.code.toUpperCase();
    if (sessions.delete(sessionCode)) {
        console.log('[Session] Closed:', sessionCode);
        res.json({ ok: true });
    } else {
        res.status(404).json({ error: 'Session not found' });
    }
});

// ─── Server ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`TitanLink Signaling Server (HTTP) running on port ${PORT}`);
    console.log(`API base: http://localhost:${PORT}`);
});
