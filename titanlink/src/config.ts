export const CONFIG = {
    SIGNALING: {
        URL: 'ws://129.159.142.124:3001',
        TIMEOUT_MS: 60000,
        MAX_RETRIES: 3,
    },
    ICE_SERVERS: [
        // Google STUN servers (high availability)
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        // Mozilla STUN (backup)
        { urls: 'stun:stun.services.mozilla.com:3478' },
        // Twilio STUN (backup)
        { urls: 'stun:global.stun.twilio.com:3478' },
    ]
};
