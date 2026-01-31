/**
 * TurnServerManager - Multi-TURN server support with health checking and failover
 * 
 * Features:
 * - Multiple TURN server configuration (primary + fallbacks)
 * - Health checking with latency measurement
 * - Automatic failover to healthy servers
 * - Integration with free public TURN as last resort
 * - HMAC-based time-limited credentials (RFC 5389)
 */

import crypto from 'crypto';
import dgram from 'dgram';

export interface IceServerConfig {
    urls: string | string[];
    username?: string;
    credential?: string;
}

export interface TurnServerEntry {
    url: string;
    secret: string;
    priority: number; // Lower = higher priority
    label?: string;
    healthy?: boolean;
    latencyMs?: number;
    lastCheck?: number;
}

// Free public TURN servers as emergency fallback
const FREE_PUBLIC_TURN_SERVERS: IceServerConfig[] = [
    // OpenRelay Project - Free TURN (rate limited but reliable)
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
];

export class SelfHostedTurnService {
    private servers: TurnServerEntry[] = [];
    private ttlSeconds: number = 86400; // 24 hours default
    private healthCheckIntervalMs: number = 60000; // Check every minute
    private lastHealthCheck: number = 0;

    constructor() {
        this.loadServersFromEnv();
    }

    /**
     * Load TURN servers from environment variables
     * Supports multiple servers via comma-separated URLs
     * 
     * Format: TURN_SERVER_URL=turn:ip1:3478,turn:ip2:3478
     *         TURN_SERVER_SECRET=secret1,secret2
     */
    private loadServersFromEnv(): void {
        const urlsEnv = process.env.TURN_SERVER_URL || '';
        const secretsEnv = process.env.TURN_SERVER_SECRET || '';

        if (!urlsEnv || !secretsEnv) {
            console.log('[TurnManager] No TURN servers configured in environment');
            return;
        }

        const urls = urlsEnv.split(',').map(u => u.trim()).filter(u => u);
        const secrets = secretsEnv.split(',').map(s => s.trim()).filter(s => s);

        // If only one secret provided, use it for all servers
        const normalizedSecrets = secrets.length === 1
            ? urls.map(() => secrets[0])
            : secrets;

        urls.forEach((url, index) => {
            if (normalizedSecrets[index]) {
                this.servers.push({
                    url,
                    secret: normalizedSecrets[index],
                    priority: index,
                    label: `Server-${index + 1}`,
                    healthy: true, // Assume healthy until checked
                });
            }
        });

        console.log(`[TurnManager] Loaded ${this.servers.length} TURN server(s) from environment`);
    }

    /**
     * Check if any self-hosted TURN is configured
     */
    isConfigured(): boolean {
        return this.servers.length > 0;
    }

    /**
     * Add a TURN server at runtime
     */
    addServer(url: string, secret: string, priority?: number, label?: string): void {
        const existingIndex = this.servers.findIndex(s => s.url === url);
        if (existingIndex >= 0) {
            // Update existing
            this.servers[existingIndex] = {
                ...this.servers[existingIndex],
                secret,
                priority: priority ?? this.servers[existingIndex].priority,
                label: label ?? this.servers[existingIndex].label,
            };
        } else {
            this.servers.push({
                url,
                secret,
                priority: priority ?? this.servers.length,
                label: label ?? `Server-${this.servers.length + 1}`,
                healthy: true,
            });
        }
        console.log(`[TurnManager] Added/updated TURN server: ${label || url}`);
    }

    /**
     * Configure multiple TURN servers at once
     */
    configure(serverUrl: string, secret: string, ttlSeconds?: number): void {
        // Clear existing and add as primary
        this.servers = [];
        this.addServer(serverUrl, secret, 0, 'Primary');
        if (ttlSeconds) {
            this.ttlSeconds = ttlSeconds;
        }
    }

    /**
     * Configure multiple servers at once
     */
    configureMultiple(entries: Array<{ url: string; secret: string; label?: string }>): void {
        this.servers = entries.map((entry, index) => ({
            url: entry.url,
            secret: entry.secret,
            priority: index,
            label: entry.label || `Server-${index + 1}`,
            healthy: true,
        }));
        console.log(`[TurnManager] Configured ${this.servers.length} TURN servers`);
    }

    /**
     * Generate time-limited TURN credentials using HMAC-SHA1
     */
    generateCredentials(secret: string, userId: string = 'titanlink'): { username: string; credential: string; expiresAt: number } {
        const expiresAt = Math.floor(Date.now() / 1000) + this.ttlSeconds;
        const username = `${expiresAt}:${userId}`;

        const hmac = crypto.createHmac('sha1', secret);
        hmac.update(username);
        const credential = hmac.digest('base64');

        return {
            username,
            credential,
            expiresAt: expiresAt * 1000,
        };
    }

    /**
     * Parse TURN URL to extract host and port
     */
    private parseUrl(url: string): { host: string; port: string } {
        const cleanUrl = url.replace(/^turns?:/, '').split('?')[0];
        const parts = cleanUrl.split(':');
        return {
            host: parts[0],
            port: parts[1] || '3478',
        };
    }

    /**
     * Check if a TURN server is reachable (basic UDP ping)
     */
    async checkServerHealth(server: TurnServerEntry): Promise<{ healthy: boolean; latencyMs: number }> {
        return new Promise((resolve) => {
            const { host, port } = this.parseUrl(server.url);
            const startTime = Date.now();
            const timeout = 3000; // 3 second timeout

            try {
                const socket = dgram.createSocket('udp4');

                const timer = setTimeout(() => {
                    socket.close();
                    resolve({ healthy: false, latencyMs: timeout });
                }, timeout);

                // STUN Binding Request (minimal valid packet)
                const stunRequest = Buffer.from([
                    0x00, 0x01, // Binding Request
                    0x00, 0x00, // Message Length
                    0x21, 0x12, 0xa4, 0x42, // Magic Cookie
                    // Transaction ID (12 bytes)
                    ...crypto.randomBytes(12),
                ]);

                socket.on('message', () => {
                    clearTimeout(timer);
                    const latencyMs = Date.now() - startTime;
                    socket.close();
                    resolve({ healthy: true, latencyMs });
                });

                socket.on('error', () => {
                    clearTimeout(timer);
                    socket.close();
                    resolve({ healthy: false, latencyMs: timeout });
                });

                socket.send(stunRequest, parseInt(port), host);
            } catch {
                resolve({ healthy: false, latencyMs: 3000 });
            }
        });
    }

    /**
     * Run health checks on all configured servers
     */
    async runHealthChecks(): Promise<void> {
        if (this.servers.length === 0) return;

        console.log(`[TurnManager] Running health checks on ${this.servers.length} server(s)...`);

        const checks = this.servers.map(async (server) => {
            const result = await this.checkServerHealth(server);
            server.healthy = result.healthy;
            server.latencyMs = result.latencyMs;
            server.lastCheck = Date.now();

            const status = result.healthy ? '✓' : '✗';
            console.log(`[TurnManager] ${status} ${server.label}: ${result.latencyMs}ms`);
        });

        await Promise.all(checks);
        this.lastHealthCheck = Date.now();

        // Re-sort servers by health and latency
        this.servers.sort((a, b) => {
            // Healthy servers first
            if (a.healthy !== b.healthy) return a.healthy ? -1 : 1;
            // Then by latency
            return (a.latencyMs || 9999) - (b.latencyMs || 9999);
        });
    }

    /**
     * Get the best available TURN servers (sorted by health/latency)
     */
    getHealthyServers(): TurnServerEntry[] {
        return this.servers.filter(s => s.healthy !== false);
    }

    /**
     * Get ICE servers configuration with all available TURN servers
     * Prioritizes self-hosted, falls back to free public TURN
     */
    async getIceServers(): Promise<IceServerConfig[]> {
        // Run health checks if stale (> 1 minute)
        if (Date.now() - this.lastHealthCheck > this.healthCheckIntervalMs) {
            await this.runHealthChecks();
        }

        const iceServers: IceServerConfig[] = [];

        // Add STUN servers first (always needed for NAT discovery)
        iceServers.push(
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
        );

        // Add healthy self-hosted TURN servers
        const healthyServers = this.getHealthyServers();

        for (const server of healthyServers) {
            const { host, port } = this.parseUrl(server.url);
            const { username, credential } = this.generateCredentials(server.secret);

            // Add STUN endpoint for this server
            iceServers.push({ urls: `stun:${host}:${port}` });

            // TURN over UDP (fastest)
            iceServers.push({
                urls: `turn:${host}:${port}`,
                username,
                credential,
            });

            // TURN over TCP (for restrictive firewalls)
            iceServers.push({
                urls: `turn:${host}:${port}?transport=tcp`,
                username,
                credential,
            });

            // TURNS over TLS (most firewall-friendly)
            iceServers.push({
                urls: `turns:${host}:5349?transport=tcp`,
                username,
                credential,
            });
        }

        // If no healthy self-hosted servers, add free public TURN as fallback
        if (healthyServers.length === 0) {
            console.log('[TurnManager] No healthy self-hosted TURN, using free public TURN fallback');
            iceServers.push(...FREE_PUBLIC_TURN_SERVERS);
        }

        console.log(`[TurnManager] Returning ${iceServers.length} ICE servers (${healthyServers.length} self-hosted healthy)`);
        return iceServers;
    }

    /**
     * Synchronous version for backwards compatibility
     * Note: Won't include health check results if called before async version
     */
    getIceServersSync(): IceServerConfig[] {
        const iceServers: IceServerConfig[] = [];

        // Add STUN servers
        iceServers.push(
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
        );

        // Add all configured TURN servers
        for (const server of this.servers) {
            const { host, port } = this.parseUrl(server.url);
            const { username, credential } = this.generateCredentials(server.secret);

            iceServers.push({ urls: `stun:${host}:${port}` });
            iceServers.push({ urls: `turn:${host}:${port}`, username, credential });
            iceServers.push({ urls: `turn:${host}:${port}?transport=tcp`, username, credential });
            iceServers.push({ urls: `turns:${host}:5349?transport=tcp`, username, credential });
        }

        // Add free public TURN as fallback
        if (this.servers.length === 0) {
            iceServers.push(...FREE_PUBLIC_TURN_SERVERS);
        }

        return iceServers;
    }

    /**
     * Get status of all configured servers
     */
    getStatus(): { configured: boolean; servers: Array<{ label: string; url: string; healthy: boolean; latencyMs: number }> } {
        return {
            configured: this.servers.length > 0,
            servers: this.servers.map(s => ({
                label: s.label || 'Unknown',
                url: s.url,
                healthy: s.healthy ?? true,
                latencyMs: s.latencyMs ?? 0,
            })),
        };
    }
}

// Singleton instance
export const selfHostedTurnService = new SelfHostedTurnService();
