/**
 * TwilioTurnService - Fetches temporary TURN credentials from Twilio
 * 
 * Twilio provides time-limited TURN credentials for secure NAT traversal.
 * Credentials typically expire after 24 hours.
 */

import https from 'https';

interface TwilioIceServer {
    url?: string;
    urls?: string | string[];
    username?: string;
    credential?: string;
}

interface TwilioTokenResponse {
    username: string;
    password: string;
    ttl: string;
    ice_servers: TwilioIceServer[];
    date_created: string;
    date_updated: string;
    account_sid: string;
}

export interface IceServerConfig {
    urls: string | string[];
    username?: string;
    credential?: string;
}

export class TwilioTurnService {
    private accountSid: string;
    private authToken: string;
    private cachedCredentials: IceServerConfig[] | null = null;
    private credentialsExpiry: number = 0;

    constructor() {
        // Read credentials from environment variables
        this.accountSid = process.env.TWILIO_ACCOUNT_SID || '';
        this.authToken = process.env.TWILIO_AUTH_TOKEN || '';
    }

    /**
     * Check if Twilio credentials are configured
     */
    isConfigured(): boolean {
        return Boolean(this.accountSid && this.authToken);
    }

    /**
     * Set Twilio credentials (for runtime configuration)
     */
    setCredentials(accountSid: string, authToken: string): void {
        this.accountSid = accountSid;
        this.authToken = authToken;
        // Invalidate cache when credentials change
        this.cachedCredentials = null;
        this.credentialsExpiry = 0;
    }

    /**
     * Fetch fresh TURN credentials from Twilio
     * Returns ICE server configuration array
     */
    async getIceServers(): Promise<IceServerConfig[]> {
        // Return cached credentials if still valid (with 5 minute buffer)
        if (this.cachedCredentials && Date.now() < this.credentialsExpiry - 300000) {
            console.log('[TwilioTurn] Using cached credentials');
            return this.cachedCredentials;
        }

        if (!this.isConfigured()) {
            console.log('[TwilioTurn] Not configured, using fallback STUN servers');
            return this.getFallbackServers();
        }

        console.log('[TwilioTurn] Fetching fresh credentials from Twilio...');

        try {
            const credentials = await this.fetchTwilioCredentials();

            // Transform Twilio response to standard ICE server format
            const iceServers: IceServerConfig[] = credentials.ice_servers.map(server => ({
                urls: server.urls || server.url || '',
                username: server.username,
                credential: server.credential,
            }));

            // Cache the credentials (Twilio TTL is typically 24 hours)
            this.cachedCredentials = iceServers;
            const ttlSeconds = parseInt(credentials.ttl) || 86400;
            this.credentialsExpiry = Date.now() + (ttlSeconds * 1000);

            console.log(`[TwilioTurn] Got ${iceServers.length} ICE servers, expires in ${ttlSeconds}s`);
            return iceServers;
        } catch (error) {
            console.error('[TwilioTurn] Failed to fetch credentials:', error);
            return this.getFallbackServers();
        }
    }

    /**
     * Fetch credentials from Twilio API
     */
    private fetchTwilioCredentials(): Promise<TwilioTokenResponse> {
        return new Promise((resolve, reject) => {
            const auth = Buffer.from(`${this.accountSid}:${this.authToken}`).toString('base64');

            const options = {
                hostname: 'api.twilio.com',
                port: 443,
                path: `/2010-04-01/Accounts/${this.accountSid}/Tokens.json`,
                method: 'POST',
                headers: {
                    'Authorization': `Basic ${auth}`,
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': 0,
                },
            };

            const req = https.request(options, (res) => {
                let data = '';

                res.on('data', chunk => {
                    data += chunk;
                });

                res.on('end', () => {
                    if (res.statusCode === 201 || res.statusCode === 200) {
                        try {
                            const parsed = JSON.parse(data);
                            resolve(parsed);
                        } catch (e) {
                            reject(new Error('Failed to parse Twilio response'));
                        }
                    } else {
                        reject(new Error(`Twilio API error: ${res.statusCode} - ${data}`));
                    }
                });
            });

            req.on('error', (error) => {
                reject(error);
            });

            req.end();
        });
    }

    /**
     * Fallback servers when Twilio is not configured
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
export const twilioTurnService = new TwilioTurnService();
