/**
 * TitanLink Application Config
 *
 * Signaling is done via HTTP REST at SIGNALING_HTTP_BASE in UDPStreamService.ts.
 * Configure via environment variables set before bundling (Vite inlines VITE_ prefixed vars).
 */

// [SECURITY] Never commit real IPs or secrets here.
// Set VITE_RELAY_IP and VITE_RELAY_PORT in your .env file.
const RELAY_IP = import.meta.env.VITE_RELAY_IP || '127.0.0.1';
const RELAY_PORT = parseInt(import.meta.env.VITE_RELAY_PORT || '5000', 10);
const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL || `http://${RELAY_IP}:3001`;

export const CONFIG = {
    RELAY: {
        IP: RELAY_IP,
        PORT: RELAY_PORT,
        SIGNALING_HTTP_BASE: SIGNALING_URL,
    },
};
