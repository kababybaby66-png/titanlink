export const CONFIG = {
    SIGNALING: {
        URL: 'ws://129.159.142.124:3001',
        TIMEOUT_MS: 60000,
        MAX_RETRIES: 3,
    },
    ICE_SERVERS: [
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
    ]
};
