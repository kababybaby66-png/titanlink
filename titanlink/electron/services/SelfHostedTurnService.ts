/**
 * SelfHostedTurnService - TURN credentials for self-hosted coturn server
 * 
 * Uses HMAC-based time-limited credentials (RFC 5389 / draft-uberti-behave-turn-rest)
 * This is the same method used by coturn's use-auth-secret option.
 */

import crypto from 'crypto';

export interface IceServerConfig {
    urls: string | string[];
    username?: string;
    credential?: string;
}

export class SelfHostedTurnService {
    private serverUrl: string;
    private secret: string;
    private ttlSeconds: number;

    constructor() {
        // Read from environment variables
        this.serverUrl = process.env.TURN_SERVER_URL || '';
        this.secret = process.env.TURN_SERVER_SECRET || '';
        this.ttlSeconds = parseInt(process.env.TURN_CREDENTIAL_TTL || '86400'); // Default 24 hours
    }

    /**
     * Check if self-hosted TURN is configured
     */
    isConfigured(): boolean {
        return Boolean(this.serverUrl && this.secret);
    }

    /**
     * Configure the TURN server at runtime
     */
    configure(serverUrl: string, secret: string, ttlSeconds?: number): void {
        this.serverUrl = serverUrl;
        this.secret = secret;
        if (ttlSeconds) {
            this.ttlSeconds = ttlSeconds;
        }
    }

    /**
     * Generate time-limited TURN credentials
     * 
     * The username format is: timestamp:userid
     * The password is: HMAC-SHA1(secret, username) base64 encoded
     */
    generateCredentials(userId: string = 'titanlink'): { username: string; credential: string; expiresAt: number } {
        const expiresAt = Math.floor(Date.now() / 1000) + this.ttlSeconds;
        const username = `${expiresAt}:${userId}`;

        // Calculate HMAC-SHA1
        const hmac = crypto.createHmac('sha1', this.secret);
        hmac.update(username);
        const credential = hmac.digest('base64');

        return {
            username,
            credential,
            expiresAt: expiresAt * 1000, // Convert to milliseconds
        };
    }

    /**
     * Get ICE servers configuration
     */
    getIceServers(): IceServerConfig[] {
        if (!this.isConfigured()) {
            console.log('[SelfHostedTurn] Not configured, using fallback STUN servers');
            return this.getFallbackServers();
        }

        const { username, credential, expiresAt } = this.generateCredentials();

        console.log(`[SelfHostedTurn] Generated credentials, expires: ${new Date(expiresAt).toISOString()}`);

        // Parse the server URL to create both STUN and TURN entries
        const serverHost = this.serverUrl.replace(/^turns?:/, '').split(':')[0];
        const serverPort = this.serverUrl.includes(':') ?
            this.serverUrl.split(':').pop()?.replace(/[^0-9]/g, '') || '3478' :
            '3478';

        return [
            // STUN (no auth needed)
            { urls: `stun:${serverHost}:${serverPort}` },

            // TURN over UDP
            {
                urls: `turn:${serverHost}:${serverPort}`,
                username,
                credential,
            },

            // TURN over TCP (for restrictive firewalls)
            {
                urls: `turn:${serverHost}:${serverPort}?transport=tcp`,
                username,
                credential,
            },

            // TURNS over TCP (TLS, port 5349 by default for coturn)
            {
                urls: `turns:${serverHost}:5349?transport=tcp`,
                username,
                credential,
            },
        ];
    }

    /**
     * Fallback STUN servers when self-hosted TURN is not configured
     */
    private getFallbackServers(): IceServerConfig[] {
        return [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'stun:stun3.l.google.com:19302' },
            { urls: 'stun:stun4.l.google.com:19302' },
        ];
    }
}

// Singleton instance
export const selfHostedTurnService = new SelfHostedTurnService();
