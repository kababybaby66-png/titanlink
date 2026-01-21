/**
 * TitanLink - Electron Main Process
 * Handles native system access, driver management, IPC coordination, and embedded signaling
 */

import { app, BrowserWindow, ipcMain, desktopCapturer, screen } from 'electron';
import path from 'path';
import { createServer, Server as HttpServer } from 'http';
import { Duplex } from 'stream';
import { DriverManager } from './services/DriverManager';
import { VirtualControllerService } from './services/VirtualControllerService';
import type { DisplayInfo, GamepadInputState } from '../shared/types/ipc';

// Keep a global reference of the window object
let mainWindow: BrowserWindow | null = null;

// Services
let driverManager: DriverManager;
let virtualController: VirtualControllerService;

// Embedded signaling server
let signalingServer: { httpServer: HttpServer } | null = null;
let signalingPort: number = 0;

interface SessionClient {
    socketId: string;
    joinedAt: number;
}

interface Session {
    hostId: string;
    hostSocketId: string;
    clients: Map<string, SessionClient>;
    createdAt: number;
}

const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;

interface SignalingMessage {
    type: 'create-session' | 'join-session' | 'signal' | 'leave-session';
    sessionCode?: string;
    hostId?: string;
    clientId?: string;
    to?: string;
    payload?: any;
}

function decodeWebSocketMessage(buffer: Buffer): { type: number; data: Buffer } {
    const firstByte = buffer[0];
    const opcode = firstByte & 0x0f;

    if (opcode === 0x8) {
        return { type: 0x8, data: Buffer.from([]) };
    }

    const secondByte = buffer[1];
    const isMasked = (secondByte & 0x80) !== 0;
    let payloadLength = secondByte & 0x7f;
    let offset = 2;

    if (payloadLength === 126) {
        payloadLength = buffer.readUInt16BE(2);
        offset = 4;
    } else if (payloadLength === 127) {
        // For payloads > 65535 bytes, we won't support that in signaling
        return { type: opcode, data: Buffer.from([]) };
    }

    let maskKey: Buffer | null = null;
    if (isMasked) {
        maskKey = buffer.slice(offset, offset + 4);
        offset += 4;
    }

    let data = buffer.slice(offset, offset + payloadLength);

    if (isMasked && maskKey) {
        const unmaskedData = Buffer.alloc(data.length);
        for (let i = 0; i < data.length; i++) {
            unmaskedData[i] = data[i] ^ maskKey[i % 4];
        }
        data = unmaskedData;
    }

    return { type: opcode, data };
}

function encodeWebSocketMessage(data: string | Buffer, opcode: number = 0x1): Buffer {
    const isString = typeof data === 'string';
    let payload: Buffer;

    if (isString) {
        payload = Buffer.from(data);
    } else {
        payload = data;
    }

    const payloadLength = payload.length;
    let headerLength = 2;

    if (payloadLength > 65535) {
        headerLength += 8;
    } else if (payloadLength > 125) {
        headerLength += 2;
    }

    const header = Buffer.alloc(headerLength);
    header[0] = 0x80 | opcode;

    if (payloadLength > 65535) {
        header[1] = 0x7f;
        header.writeBigUInt64BE(BigInt(payloadLength), 2);
    } else if (payloadLength > 125) {
        header[1] = 0x7e;
        header.writeUInt16BE(payloadLength, 2);
    } else {
        header[1] = payloadLength;
    }

    const result = Buffer.concat([header, payload]);
    console.log('[Signaling] Encoding message:', data, '->', result.length, 'bytes');
    return result;
}

function generateWebSocketAcceptKey(key: string): string {
    const crypto = require('crypto');
    const GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
    const sha1 = crypto.createHash('sha1');
    sha1.update(key + GUID);
    return sha1.digest('base64');
}

async function startEmbeddedSignalingServer(): Promise<number> {
    return new Promise((resolve) => {
        const httpServer = createServer();

        const sessions = new Map<string, Session>();
        const connections = new Map<string, { ws: Duplex; session: string | null; role: 'host' | 'client' | null; peerId: string }>();

        httpServer.on('upgrade', (req, socket: any, head) => {
            console.log('[HTTP] WebSocket upgrade request:', req.url);
            const key = req.headers['sec-websocket-key'];
            if (!key) {
                console.log('[HTTP] No Sec-WebSocket-Key header, destroying socket');
                socket.destroy();
                return;
            }

            console.log('[HTTP] WebSocket key:', key);
            const acceptKey = generateWebSocketAcceptKey(key);

            socket.write('HTTP/1.1 101 Switching Protocols\r\n');
            socket.write('Upgrade: websocket\r\n');
            socket.write('Connection: Upgrade\r\n');
            socket.write(`Sec-WebSocket-Accept: ${acceptKey}\r\n`);
            socket.write('\r\n');
            console.log('[HTTP] WebSocket upgrade complete');

            const duplex = Duplex.from({
                readable: socket,
                writable: socket,
            });

            let connId = Math.random().toString(36).substring(2);
            connections.set(connId, { ws: duplex, session: null, role: null, peerId: '' });

            let inputBuffer = Buffer.alloc(0);

            duplex.on('data', (chunk: Buffer) => {
                // console.log('[WS] Data received, chunk length:', chunk.length);
                inputBuffer = Buffer.concat([inputBuffer, chunk]);

                while (true) {
                    if (inputBuffer.length < 2) break;

                    const secondByte = inputBuffer[1];
                    const isMasked = (secondByte & 0x80) !== 0;
                    let payloadLength = secondByte & 0x7f;
                    let headerLength = 2;

                    if (payloadLength === 126) {
                        if (inputBuffer.length < 4) break;
                        payloadLength = inputBuffer.readUInt16BE(2);
                        headerLength = 4;
                    } else if (payloadLength === 127) {
                        // Skip large payloads logic as before, just break/close
                        console.error('[WS] Payload too large (127), closing.');
                        duplex.end();
                        return;
                    }

                    if (isMasked) {
                        headerLength += 4;
                    }

                    if (inputBuffer.length < headerLength + payloadLength) {
                        // Wait for more data
                        break;
                    }

                    // We have a full frame
                    const frameBuffer = inputBuffer.slice(0, headerLength + payloadLength);
                    inputBuffer = inputBuffer.slice(headerLength + payloadLength);

                    try {
                        const msg = decodeWebSocketMessage(frameBuffer);
                        // console.log('[WS] Decoded message type:', msg.type, 'data length:', msg.data.length);

                        if (msg.type === 0x8) {
                            console.log('[WS] Close frame received');
                            duplex.end();
                            return;
                        }

                        if (msg.type !== 0x1 && msg.type !== 0x2) {
                            console.log('[WS] Ignoring non-text frame, type:', msg.type);
                            continue;
                        }

                        let message: SignalingMessage;
                        try {
                            message = JSON.parse(msg.data.toString());
                            console.log('[WS] Parsed message type:', message.type);
                        } catch (e) {
                            console.error('[WS] Failed to parse JSON:', e);
                            continue;
                        }

                        const conn = connections.get(connId);
                        if (!conn) {
                            console.log('[Signaling] No connection found for connId:', connId);
                            continue;
                        }

                        if (message.type === 'create-session') {
                            console.log('[Signaling] Processing create-session:', message.sessionCode);
                            const sessionCode = message.sessionCode;
                            const hostId = message.hostId;
                            if (!sessionCode || !hostId) {
                                console.log('[Signaling] Missing sessionCode or hostId');
                                continue;
                            }

                            if (sessions.has(sessionCode)) {
                                console.log('[Signaling] Session already exists:', sessionCode);
                                conn.ws.write(encodeWebSocketMessage(JSON.stringify({ type: 'error', data: 'Session code already in use' })));
                                continue;
                            }

                            sessions.set(sessionCode, {
                                hostId,
                                hostSocketId: connId,
                                clients: new Map(),
                                createdAt: Date.now(),
                            });

                            conn.session = sessionCode;
                            conn.role = 'host';
                            conn.peerId = hostId;

                            console.log('[Signaling] Sending session-created response');
                            conn.ws.write(encodeWebSocketMessage(JSON.stringify({ type: 'session-created' })));
                            console.log('[Signaling] session-created sent. Active sessions:', sessions.size);
                        }
                        else if (message.type === 'join-session') {
                            const sessionCode = message.sessionCode;
                            const clientId = message.clientId;
                            if (!sessionCode || !clientId) continue;

                            const session = sessions.get(sessionCode);
                            if (!session) {
                                conn.ws.write(encodeWebSocketMessage(JSON.stringify({ type: 'session-not-found' })));
                                continue;
                            }

                            const clientSocketId = Math.random().toString(36).substring(7);
                            session.clients.set(clientId, { socketId: clientSocketId, joinedAt: Date.now() });

                            conn.session = sessionCode;
                            conn.role = 'client';
                            conn.peerId = clientId;

                            conn.ws.write(encodeWebSocketMessage(JSON.stringify({ type: 'session-joined', data: { hostId: session.hostId } })));

                            // Notify host
                            const hostConn = connections.get(session.hostSocketId);
                            if (hostConn) {
                                hostConn.ws.write(encodeWebSocketMessage(JSON.stringify({ type: 'peer-joined', data: { peerId: clientId } })));
                            }
                        }
                        else if (message.type === 'signal') {
                            const sessionCode = message.sessionCode;
                            if (!sessionCode) continue;

                            const session = sessions.get(sessionCode);
                            if (!session) continue;

                            const response = JSON.stringify({
                                type: 'signal',
                                data: { from: conn.peerId, to: message.to, payload: message.payload }
                            });

                            if (message.to) {
                                if (message.to === session.hostId) {
                                    const hostConn = connections.get(session.hostSocketId);
                                    if (hostConn) hostConn.ws.write(encodeWebSocketMessage(response));
                                } else {
                                    session.clients.forEach((client, clientIdKey) => {
                                        if (clientIdKey === message.to) {
                                            const targetConn = connections.get(client.socketId);
                                            if (targetConn) targetConn.ws.write(encodeWebSocketMessage(response));
                                        }
                                    });
                                }
                            } else {
                                // Broadcast to all in session
                                connections.forEach((c) => {
                                    if (c.session === sessionCode && c.ws.writable) {
                                        c.ws.write(encodeWebSocketMessage(response));
                                    }
                                });
                            }
                        }
                        else if (message.type === 'leave-session') {
                            if (conn.session) {
                                const session = sessions.get(conn.session);
                                if (session) {
                                    if (conn.role === 'host') {
                                        connections.forEach((c) => {
                                            if (c.session === conn.session && c.ws.writable) {
                                                c.ws.write(encodeWebSocketMessage(JSON.stringify({ type: 'host-left' })));
                                            }
                                        });
                                        sessions.delete(conn.session);
                                    } else {
                                        session.clients.forEach((client, clientIdKey) => {
                                            if (clientIdKey === conn.peerId) {
                                                session.clients.delete(clientIdKey);
                                                const hostConn = connections.get(session.hostSocketId);
                                                if (hostConn) {
                                                    hostConn.ws.write(encodeWebSocketMessage(JSON.stringify({ type: 'peer-left', data: { peerId: clientIdKey } })));
                                                }
                                            }
                                        });
                                    }
                                }
                                conn.session = null;
                                conn.role = null;
                                conn.peerId = '';
                            }
                        }
                    } catch (e) {
                        console.error('[WS] Error processing frame:', e);
                    }
                }
            });

            duplex.on('close', () => {
                const conn = connections.get(connId);
                if (conn && conn.session) {
                    const session = sessions.get(conn.session);
                    if (session) {
                        if (conn.role === 'host') {
                            connections.forEach((c) => {
                                if (c.session === conn.session && c.ws.writable) {
                                    c.ws.write(encodeWebSocketMessage(JSON.stringify({ type: 'host-left' })));
                                }
                            });
                            sessions.delete(conn.session);
                        } else {
                            session.clients.forEach((client, clientIdKey) => {
                                if (clientIdKey === conn.peerId) {
                                    session.clients.delete(clientIdKey);
                                    const hostConn = connections.get(session.hostSocketId);
                                    if (hostConn) {
                                        hostConn.ws.write(encodeWebSocketMessage(JSON.stringify({ type: 'peer-left', data: { peerId: clientIdKey } })));
                                    }
                                }
                            });
                        }
                    }
                }
                connections.delete(connId);
            });

            duplex.on('error', () => {
                connections.delete(connId);
            });
        });

        httpServer.on('request', (req, res) => {
            console.log('[HTTP] Request received:', req.url);
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ status: 'ok', name: 'TitanLink Signaling', sessions: sessions.size }));
        });

        let port = 0;
        httpServer.listen(() => {
            port = (httpServer.address() as any).port;
            signalingServer = { httpServer };
            signalingPort = port;
            console.log(`Embedded signaling server running on port ${port}`);
            resolve(port);
        });
    });
}

function getSignalingUrl(): string {
    return `ws://localhost:${signalingPort}`;
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        frame: false, // Custom titlebar
        titleBarStyle: 'hidden',
        backgroundColor: '#0a0a0f',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: false, // Required for some native modules
        },
        icon: path.join(__dirname, '../resources/icon.ico'),
    });

    // Load the app
    if (isDev) {
        mainWindow.loadURL('http://127.0.0.1:5173');
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

// Initialize services
async function initializeServices() {
    driverManager = new DriverManager();
    virtualController = new VirtualControllerService();

    // Check driver status on startup
    const driverStatus = await driverManager.checkDriverStatus();
    console.log('Driver status:', driverStatus);
}

// ============================================
// IPC Handlers
// ============================================

function registerIpcHandlers() {
    // System handlers
    ipcMain.handle('system:check-drivers', async () => {
        return await driverManager.checkDriverStatus();
    });

    ipcMain.handle('system:install-vigembus', async () => {
        return await driverManager.installViGEmBus();
    });

    ipcMain.handle('system:get-displays', async (): Promise<DisplayInfo[]> => {
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: 0, height: 0 }
        });

        const displays = screen.getAllDisplays();

        return sources.map((source, index) => {
            const display = displays[index] || displays[0];
            // Use scaleFactor to get actual physical resolution
            const scaleFactor = display.scaleFactor || 1;
            return {
                id: source.id,
                name: source.name,
                width: Math.round(display.size.width * scaleFactor),
                height: Math.round(display.size.height * scaleFactor),
                primary: display.id === screen.getPrimaryDisplay().id,
            };
        });
    });

    // Controller handlers - these run in main process for native access
    ipcMain.handle('controller:create-virtual', async () => {
        return await virtualController.createController();
    });

    ipcMain.handle('controller:destroy-virtual', async () => {
        return await virtualController.destroyController();
    });

    // Receive controller input from renderer (which receives it from WebRTC)
    ipcMain.on('controller:input', (_event, input: GamepadInputState) => {
        virtualController.updateInput(input);
    });

    // Signaling server handlers - embedded P2P signaling
    ipcMain.handle('signaling:start', async () => {
        if (!signalingServer) {
            await startEmbeddedSignalingServer();
        }
        return getSignalingUrl();
    });

    ipcMain.handle('signaling:get-url', () => {
        if (!signalingServer) {
            return null;
        }
        return getSignalingUrl();
    });

    // Window control handlers (for custom titlebar)
    ipcMain.on('window:minimize', () => mainWindow?.minimize());
    ipcMain.on('window:maximize', () => {
        if (mainWindow?.isMaximized()) {
            mainWindow.unmaximize();
        } else {
            mainWindow?.maximize();
        }
    });
    ipcMain.on('window:close', () => mainWindow?.close());
}

// ============================================
// App Lifecycle
// ============================================

app.whenReady().then(async () => {
    await initializeServices();
    registerIpcHandlers();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    // Cleanup services
    virtualController?.destroyController();

    if (process.platform !== 'darwin') {
        app.quit();
    }
});

// Handle app shutdown gracefully
app.on('before-quit', async () => {
    await virtualController?.destroyController();
});
