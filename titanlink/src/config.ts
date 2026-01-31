export const CONFIG = {
    SIGNALING: {
        URL: 'ws://129.159.142.124:3001',
        TIMEOUT_MS: 60000,
        MAX_RETRIES: 3,
    },

    // STUN servers (for NAT discovery - always free)
    STUN_SERVERS: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:stun.services.mozilla.com:3478' },
        { urls: 'stun:global.stun.twilio.com:3478' },
    ],

    // Free public TURN servers as emergency fallback
    // These have rate limits but are better than no relay at all
    FREE_TURN_SERVERS: [
        // OpenRelay Project - Free TURN (rate limited)
        {
            urls: 'turn:openrelay.metered.ca:80',
            username: 'openrelayproject',
            credential: 'openrelayproject',
        },
        {
            urls: 'turn:openrelay.metered.ca:443',
            username: 'openrelayproject',
            credential: 'openrelayproject',
        },
        {
            urls: 'turn:openrelay.metered.ca:443?transport=tcp',
            username: 'openrelayproject',
            credential: 'openrelayproject',
        },
        // ExpressTurn - Free tier (limited bandwidth)
        {
            urls: 'turn:relay1.expressturn.com:3478',
            username: 'efJ7UPKR7XCHQHP7PX',
            credential: 'aWxr2yjJi7K17W2J',
        },
    ],

    // Legacy ICE_SERVERS for backwards compatibility
    ICE_SERVERS: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
        { urls: 'stun:stun2.l.google.com:19302' },
        { urls: 'stun:stun3.l.google.com:19302' },
        { urls: 'stun:stun4.l.google.com:19302' },
        { urls: 'stun:stun.services.mozilla.com:3478' },
        { urls: 'stun:global.stun.twilio.com:3478' },
    ],

    // ICE gathering configuration
    ICE_CONFIG: {
        // Time to wait for ICE gathering before giving up (ms)
        GATHERING_TIMEOUT_MS: 10000,
        // Prefer relay candidates for better reliability (at cost of latency)
        PREFER_RELAY: false,
        // Enable aggressive ICE nomination for faster connection
        AGGRESSIVE_NOMINATION: true,
    },
};
