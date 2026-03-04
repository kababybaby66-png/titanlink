export class WebSocketSignalingClient extends EventTarget {
    private url: string;
    private ws: WebSocket | null = null;
    private sessionCode: string = '';
    private peerId: string = '';
    private role: 'host' | 'client' = 'client';

    public onopen: (() => void) | null = null;
    public onclose: (() => void) | null = null;
    public onerror: ((ev: any) => void) | null = null;
    public onmessage: ((ev: { data: string }) => void) | null = null;

    get readyState(): number {
        return this.ws ? this.ws.readyState : 0;
    }

    constructor(baseUrl: string) {
        super();
        const wsUrl = baseUrl.replace(/^http/, 'ws');
        this.url = baseUrl;

        try {
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                if (this.onopen) this.onopen();
            };

            this.ws.onclose = () => {
                if (this.onclose) this.onclose();
            };

            this.ws.onerror = (err) => {
                if (this.onerror) this.onerror(err);
            };

            this.ws.onmessage = (event) => {
                if (this.onmessage) this.onmessage(event);
                this.dispatchEvent(new MessageEvent('message', { data: event.data }));
            };
        } catch (e) {
            console.error('[WebSocket Error]', e);
        }
    }

    async send(dataStr: string) {
        try {
            const data = JSON.parse(dataStr);
            if (data.type === 'create-session') {
                this.sessionCode = data.sessionCode;
                this.peerId = data.hostId;
                this.role = 'host';

                // Keep the HTTP call for session creation to maintain the exact same API & hostToken logic
                const res = await fetch(`${this.url}/session`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionCode: data.sessionCode, sessionId: this.peerId, hostId: data.hostId })
                });

                if (res.ok) {
                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                        this.ws.send(JSON.stringify({ action: 'register', sessionCode: data.sessionCode, peerId: data.hostId }));
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
                    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                        this.ws.send(JSON.stringify({ action: 'register', sessionCode: data.sessionCode, peerId: data.clientId }));
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
                // Now send the signal over WebSocket directly!
                if (this.ws && this.ws.readyState === WebSocket.OPEN) {
                    this.ws.send(JSON.stringify({
                        action: 'signal',
                        sessionCode: data.sessionCode || this.sessionCode,
                        to: data.to,
                        type: data.payload.type || 'ice',
                        payload: data.payload
                    }));
                } else {
                    console.warn('[WebSocket] Cannot send signal, socket not open');
                }
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
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }
}
