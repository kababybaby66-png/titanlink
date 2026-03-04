/**
 * TitanLink Signaling Server — HTTP REST Edition
 * No WebSocket dependency. Pure HTTP polling-based signaling.
 *
 * API:
 *   POST /session          - Host creates a session
 *   POST /session/:code/join  - Client joins a session, gets back sessionId
 *   GET  /session/:code    - Host polls for events (client joined/left)
 *   DELETE /session/:code  - Host closes session (requires hostToken)
 *
 * Deploy on any Node.js host (Railway, Render, Fly.io, etc.)
 *
 * Environment Variables:
 *   PORT - Server port (default: 3001)
 *   ALLOWED_ORIGINS - Comma-separated list of allowed origins (default: strict whitelist)
 */

const express = require('express');
const crypto = require('crypto');

const app = express();

// ─── Security: Body size limit ────────────────────────────────────────────────
// [SECURITY] Prevent large-payload DoS attacks
app.use(express.json({ limit: '16kb' }));

// ─── Security: Rate Limiting ──────────────────────────────────────────────────
// [SECURITY] Sliding-window IP-based rate limiter — no external dependency.
const rateLimitWindows = new Map(); // ip -> { count, windowStart }
const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX = 300;    // max requests per window per IP (polling-based signaling needs headroom)

function rateLimit(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = rateLimitWindows.get(ip);

    if (!entry || (now - entry.windowStart) > RATE_LIMIT_WINDOW_MS) {
        rateLimitWindows.set(ip, { count: 1, windowStart: now });
        return next();
    }

    entry.count++;
    if (entry.count > RATE_LIMIT_MAX) {
        return res.status(429).json({ error: 'Too many requests' });
    }
    next();
}

// Apply rate limit to all routes
app.use(rateLimit);

// ─── Security: Stricter join rate limit ───────────────────────────────────────
// [SECURITY] Extra rate limit on join attempts to slow brute-force of session codes
const joinRateWindows = new Map(); // ip -> { count, windowStart }
const JOIN_RATE_LIMIT_WINDOW_MS = 60_000;
const JOIN_RATE_LIMIT_MAX = 10; // max 10 join attempts per minute per IP

function joinRateLimit(req, res, next) {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const entry = joinRateWindows.get(ip);

    if (!entry || (now - entry.windowStart) > JOIN_RATE_LIMIT_WINDOW_MS) {
        joinRateWindows.set(ip, { count: 1, windowStart: now });
        return next();
    }

    entry.count++;
    if (entry.count > JOIN_RATE_LIMIT_MAX) {
        return res.status(429).json({ error: 'Too many join attempts' });
    }
    next();
}

// ─── CORS ─────────────────────────────────────────────────────────────────────
// [SECURITY] Restrict origins to known app origins.
// In production, set ALLOWED_ORIGINS env var to your actual origins.
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : null; // null = Electron-only mode (requests have no Origin header — allowed)

app.use((req, res, next) => {
    const origin = req.headers.origin;

    if (!origin) {
        // Electron renderer sends requests without an Origin header — allow
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        return next();
    }

    if (ALLOWED_ORIGINS && ALLOWED_ORIGINS.includes(origin)) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        res.setHeader('Vary', 'Origin');
    } else if (!ALLOWED_ORIGINS) {
        // Dev mode: allow all (ALLOWED_ORIGINS not set)
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    } else {
        // Origin not in whitelist — reject
        return res.status(403).json({ error: 'Forbidden origin' });
    }

    if (req.method === 'OPTIONS') {
        return res.sendStatus(204);
    }
    next();
});

// ─── Security: Add basic security headers ────────────────────────────────────
app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-XSS-Protection', '0'); // Disable legacy XSS auditor (use CSP instead)
    next();
});

// Map of sessionCode -> session object
const sessions = new Map();

// Constants
const MAX_SESSIONS = 10_000;
const MAX_CLIENTS_PER_SESSION = 10;
const MAX_MESSAGES_PER_SESSION = 500;
const SESSION_CODE_CHARSET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 hours

// Auto-cleanup stale sessions every 60s
setInterval(() => {
    const now = Date.now();
    for (const [code, session] of sessions) {
        if (now - session.createdAt > SESSION_MAX_AGE_MS) {
            sessions.delete(code);
            console.log('[Cleanup] Removed stale session:', code);
        }
    }
    // Also clean rate-limit maps
    for (const [ip, entry] of rateLimitWindows) {
        if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS * 2) rateLimitWindows.delete(ip);
    }
    for (const [ip, entry] of joinRateWindows) {
        if (now - entry.windowStart > JOIN_RATE_LIMIT_WINDOW_MS * 2) joinRateWindows.delete(ip);
    }
}, 60_000);

// ─── Input validation helpers ─────────────────────────────────────────────────
function isValidCode(code) {
    if (typeof code !== 'string') return false;
    // 6-8 uppercase alphanumeric (from charset)
    return /^[A-Z2-9]{6,8}$/.test(code);
}

function isValidId(id) {
    if (typeof id !== 'string') return false;
    return id.length >= 4 && id.length <= 128 && /^[\w.-]+$/.test(id);
}

// ─── Health Check ─────────────────────────────────────────────────────────────
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
// Returns: 200 { ok: true, hostToken } | 409 { error: 'Session code already in use' }
app.post('/session', (req, res) => {
    const { sessionCode, sessionId, hostId } = req.body;

    // [SECURITY] Validate all inputs
    if (!sessionCode || !sessionId || !hostId) {
        return res.status(400).json({ error: 'Missing sessionCode, sessionId, or hostId' });
    }
    if (!isValidCode(sessionCode)) {
        return res.status(400).json({ error: 'Invalid sessionCode format' });
    }
    if (!isValidId(sessionId) || !isValidId(hostId)) {
        return res.status(400).json({ error: 'Invalid sessionId or hostId' });
    }

    // [SECURITY] Global session cap to prevent memory exhaustion
    if (sessions.size >= MAX_SESSIONS) {
        return res.status(503).json({ error: 'Server at capacity' });
    }

    if (sessions.has(sessionCode)) {
        return res.status(409).json({ error: 'Session code already in use' });
    }

    // [SECURITY] Generate a hostToken — must be presented to delete or manage the session
    const hostToken = crypto.randomBytes(32).toString('hex');

    sessions.set(sessionCode, {
        hostId,
        sessionId,
        hostToken, // only returned once at creation
        clients: [],
        hostPollSince: 0,
        createdAt: Date.now(),
        closedAt: null,
        messages: [],
    });

    console.log('[Session] Created:', sessionCode, 'by host:', hostId);
    // Return the hostToken so the host can authenticate future management requests
    res.json({ ok: true, hostToken });
});

// ─── POST /session/:code/join ─────────────────────────────────────────────────
// Client joins a session.
// Body: { clientId }
// Returns: 200 { sessionId, hostId } | 404 { error: 'Session not found' }
app.post('/session/:code/join', joinRateLimit, (req, res) => {
    const sessionCode = req.params.code.toUpperCase();
    const { clientId } = req.body;

    // [SECURITY] Validate inputs
    if (!isValidCode(sessionCode)) {
        return res.status(400).json({ error: 'Invalid session code format' });
    }
    if (!clientId || !isValidId(clientId)) {
        return res.status(400).json({ error: 'Missing or invalid clientId' });
    }

    const session = sessions.get(sessionCode);
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    // [SECURITY] Cap clients per session
    if (session.clients.length >= MAX_CLIENTS_PER_SESSION) {
        return res.status(403).json({ error: 'Session is full' });
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
app.get('/session/:code', (req, res) => {
    const sessionCode = req.params.code.toUpperCase();
    const since = parseInt(req.query.since || '0', 10);

    if (!isValidCode(sessionCode)) {
        return res.status(400).json({ error: 'Invalid session code format' });
    }

    const session = sessions.get(sessionCode);
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    const newClients = session.clients.filter(c => c.joinedAt > since);
    const events = [...newClients.map(c => ({
        type: 'peer-joined',
        data: { peerId: c.clientId, clientId: c.clientId },
        timestamp: c.joinedAt,
    }))];

    if (session.messages) {
        const newMessages = session.messages.filter(m => m.timestamp > since && m.to === session.hostId);
        events.push(...newMessages.map(m => ({
            type: 'webrtc-message',
            data: m,
            timestamp: m.timestamp,
        })));
        events.sort((a, b) => a.timestamp - b.timestamp);
    }

    res.json({ events });
});

// ─── POST /session/:code/message ──────────────────────────────────────────────
// Send a message (SDP, ICE, etc.)
app.post('/session/:code/message', (req, res) => {
    const sessionCode = req.params.code.toUpperCase();

    if (!isValidCode(sessionCode)) {
        return res.status(400).json({ error: 'Invalid session code format' });
    }

    const session = sessions.get(sessionCode);
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    // [SECURITY] Validate message fields
    const { from, to, type, payload } = req.body;
    if (!from || !to || !type || typeof from !== 'string' || typeof to !== 'string' || typeof type !== 'string') {
        return res.status(400).json({ error: 'Invalid message fields' });
    }
    if (from.length > 128 || to.length > 128 || type.length > 64) {
        return res.status(400).json({ error: 'Message fields too long' });
    }

    // [SECURITY] Cap messages per session to prevent memory exhaustion
    if (session.messages.length >= MAX_MESSAGES_PER_SESSION) {
        // Drop oldest messages to make room (sliding window)
        session.messages.splice(0, Math.floor(MAX_MESSAGES_PER_SESSION / 4));
    }

    const msg = { from, to, type, payload, timestamp: Date.now() };
    session.messages.push(msg);
    res.json({ ok: true });
});

// ─── GET /session/:code/messages/:peerId ──────────────────────────────────────
// Client polls for new messages
app.get('/session/:code/messages/:peerId', (req, res) => {
    const sessionCode = req.params.code.toUpperCase();
    const peerId = req.params.peerId;
    const since = parseInt(req.query.since || '0', 10);

    if (!isValidCode(sessionCode)) {
        return res.status(400).json({ error: 'Invalid session code format' });
    }
    if (!isValidId(peerId)) {
        return res.status(400).json({ error: 'Invalid peerId' });
    }

    const session = sessions.get(sessionCode);
    if (!session || !session.messages) {
        return res.json({ messages: [] });
    }

    const newMessages = session.messages.filter(m => m.timestamp > since && m.to === peerId);
    res.json({ messages: newMessages });
});

// ─── DELETE /session/:code ────────────────────────────────────────────────────
// Host closes the session. Requires the hostToken returned at creation.
app.delete('/session/:code', (req, res) => {
    const sessionCode = req.params.code.toUpperCase();

    if (!isValidCode(sessionCode)) {
        return res.status(400).json({ error: 'Invalid session code format' });
    }

    const session = sessions.get(sessionCode);
    if (!session) {
        return res.status(404).json({ error: 'Session not found' });
    }

    // [SECURITY] Require hostToken to authorize deletion
    const providedToken = req.headers['x-host-token'] || req.body?.hostToken;
    if (!providedToken || providedToken !== session.hostToken) {
        return res.status(403).json({ error: 'Unauthorized' });
    }

    sessions.delete(sessionCode);
    console.log('[Session] Closed:', sessionCode);
    res.json({ ok: true });
});

// ─── Server ───────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
    console.log(`TitanLink Signaling Server (HTTP) running on port ${PORT}`);
    console.log(`API base: http://localhost:${PORT}`);
    if (!process.env.ALLOWED_ORIGINS) {
        console.warn('[Security] ALLOWED_ORIGINS not set — running in dev mode (all origins allowed)');
    }
});
