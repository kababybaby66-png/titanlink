/**
 * TitanLink Application Config
 *
 * Signaling is now done via HTTP REST at SIGNALING_BASE in UDPStreamService.ts.
 * WebRTC and STUN/TURN are no longer used — the app uses its own UDP relay.
 */
export const CONFIG = {
    // Relay server (Oracle VM)
    RELAY: {
        IP: '129.159.142.124',
        PORT: 5000,
        SIGNALING_HTTP_BASE: 'http://129.159.142.124:3001',
    },
};
