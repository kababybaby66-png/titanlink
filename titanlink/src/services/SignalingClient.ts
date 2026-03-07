export class WebSocketSignalingClient extends EventTarget {
    private url: string;
    private wsUrl: string;
    private ws: WebSocket | null = null;
    private sessionCode: string = '';
    private peerId: string = '';
    private role: 'host' | 'client' = 'client';
    private pendingQueue: string[] = [];
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private reconnectAttempts: number = 0;
    private maxReconnectAttempts: number = 10;
    private closed: boolean = false;
    private registered: boolean = false;
    private wsReady: Promise<void>;
    private wsReadyResolve: (() => void) | null = null;

    public onopen: (() => void) | null = null;
    public onclose: (() => void) | null = null;
    public onerror: ((ev: any) => void) | null = null;
    public onmessage: ((ev: { data: string }) => void) | null = null;

    get readyState(): number {
        return this.ws ? this.ws.readyState : 0;
    }

    constructor(baseUrl: string) {
        super();
        this.wsUrl = baseUrl.replace(/^http/, 'ws');
        this.url = baseUrl;
        this.wsReady = new Promise(resolve => { this.wsReadyResolve = resolve; });

        this.createWebSocket();
    }

    private createWebSocket(): void {
        if (this.closed) return;

        try {
            this.ws = new WebSocket(this.wsUrl);

            this.ws.onopen = () => {
                console.log('[WebSocket] Connected to signaling server');
                this.reconnectAttempts = 0;

                if (this.wsReadyResolve) {
                    this.wsReadyResolve();
                    this.wsReadyResolve = null;
                }

                // Re-register if we had a previous session
                if (this.sessionCode && this.peerId) {
                    this.ws!.send(JSON.stringify({
                        action: 'register',
                        sessionCode: this.sessionCode,
                        peerId: this.peerId,
                    }));
                    this.registered = true;
                }

                // Flush any queued signals
                this.flushQueue();

                if (this.onopen) this.onopen();
            };

            this.ws.onclose = () => {
                console.warn('[WebSocket] Connection closed');
                this.registered = false;
                if (this.onclose) this.onclose();
                this.scheduleReconnect();
            };

            this.ws.onerror = (err) => {
                console.error('[WebSocket] Error:', err);
                if (this.onerror) this.onerror(err);
            };

            this.ws.onmessage = (event) => {
                if (this.onmessage) this.onmessage(event);
                this.dispatchEvent(new MessageEvent('message', { data: event.data }));
            };
        } catch (e) {
            console.error('[WebSocket] Failed to create connection:', e);
            this.scheduleReconnect();
        }
    }

    private scheduleReconnect(): void {
        if (this.closed) return;
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('[WebSocket] Max reconnect attempts reached, giving up');
            return;
        }

        const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 15000);
        this.reconnectAttempts++;
        console.log(`[WebSocket] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);

        this.reconnectTimer = setTimeout(() => {
            // Reset the wsReady promise for new connection
            this.wsReady = new Promise(resolve => { this.wsReadyResolve = resolve; });
            this.createWebSocket();
        }, delay);
    }

    private flushQueue(): void {
        if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;

        while (this.pendingQueue.length > 0) {
            const msg = this.pendingQueue.shift()!;
            try {
                this.ws.send(msg);
            } catch (e) {
                console.error('[WebSocket] Failed to flush queued message:', e);
                this.pendingQueue.unshift(msg);
                break;
            }
        }
    }

    /**
     * Send a signal directly over the WebSocket, or queue it if not ready.
     * Falls back to HTTP POST if the socket stays closed.
     */
    private sendSignalOverWs(data: any): void {
        const wsPayload = JSON.stringify({
            action: 'signal',
            sessionCode: data.sessionCode || this.sessionCode,
            to: data.to,
            type: data.payload.type || 'ice',
            payload: data.payload,
        });

        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(wsPayload);
        } else {
            // Queue the message — it'll be flushed on reconnect
            this.pendingQueue.push(wsPayload);
            console.log(`[WebSocket] Signal queued (socket not open yet, queue size: ${this.pendingQueue.length})`);

            // Also send via HTTP as a fallback so signaling isn't lost
            this.sendSignalOverHttp(data).catch(err => {
                console.warn('[WebSocket] HTTP signal fallback also failed:', err);
            });
        }
    }

    /**
     * HTTP fallback for sending signals when WebSocket is unavailable
     */
    private async sendSignalOverHttp(data: any): Promise<void> {
        const sessionCode = data.sessionCode || this.sessionCode;
        const res = await fetch(`${this.url}/session/${sessionCode}/message`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                from: this.peerId,
                to: data.to,
                type: data.payload.type || 'ice',
                payload: data.payload,
            }),
        });
        if (!res.ok) {
            throw new Error(`HTTP signal failed: ${res.status}`);
        }
    }

    async send(dataStr: string) {
        try {
            const data = JSON.parse(dataStr);
            if (data.type === 'create-session') {
                this.sessionCode = data.sessionCode;
                this.peerId = data.hostId;
                this.role = 'host';

                const res = await fetch(`${this.url}/session`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionCode: data.sessionCode, sessionId: this.peerId, hostId: data.hostId })
                });

                if (res.ok) {
                    // Wait for WebSocket to be ready before registering
                    await Promise.race([this.wsReady, new Promise(resolve => setTimeout(resolve, 3000))]);

                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                        this.ws.send(JSON.stringify({ action: 'register', sessionCode: data.sessionCode, peerId: data.hostId }));
                        this.registered = true;
                    } else {
                        console.warn('[WebSocket] Socket not open after wait, will register on reconnect');
                    }
                    this.emitMessage({ type: 'session-created' });
                } else {
                    const err = await res.json();
                    this.emitMessage({ type: 'error', data: err.error });
                }
            } else if (data.type === 'join-session') {
                this.sessionCode = data.sessionCode;
                this.peerId = data.clientId;
                this.role = 'client';

                const res = await fetch(`${this.url}/session/${data.sessionCode}/join`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ clientId: data.clientId })
                });

                if (res.ok) {
                    const result = await res.json();

                    // Wait for WebSocket to be ready before registering
                    await Promise.race([this.wsReady, new Promise(resolve => setTimeout(resolve, 3000))]);

                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                        this.ws.send(JSON.stringify({ action: 'register', sessionCode: data.sessionCode, peerId: data.clientId }));
                        this.registered = true;
                    } else {
                        console.warn('[WebSocket] Socket not open after wait, will register on reconnect');
                    }
                    this.emitMessage({ type: 'session-joined', data: { hostId: result.hostId } });
                } else {
                    this.emitMessage({ type: 'session-not-found' });
                }
            } else if (data.type === 'leave-session') {
                if (this.role === 'host') {
                    await fetch(`${this.url}/session/${data.sessionCode}`, { method: 'DELETE' }).catch(() => { });
                }
            } else if (data.type === 'signal') {
                this.sendSignalOverWs(data);
            }
        } catch (e) {
            console.error('[WebSocket Signaler Error]', e);
        }
    }

    private emitMessage(msg: any) {
        const ev = { data: JSON.stringify(msg) };
        if (this.onmessage) this.onmessage(ev as any);
        this.dispatchEvent(new MessageEvent('message', ev));
    }

    close() {
        this.closed = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}
