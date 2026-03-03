import { app, BrowserWindow, ipcMain, desktopCapturer, screen, session } from 'electron';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';

dotenv.config({ path: path.join(__dirname, '../.env') });

app.commandLine.appendSwitch('force_high_performance_gpu');

// Log minimal platform info (dev only — avoid leaking environment in production)
if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
    console.log(`[Main] Platform: ${process.platform}, Arch: ${process.arch}`);
}

import { DriverManager } from './services/DriverManager';
import { VirtualControllerService } from './services/VirtualControllerService';
import { selfHostedTurnService } from './services/SelfHostedTurnService';
import { hardwareCaptureService } from './services/HardwareCaptureService';
import { virtualDisplayService } from './services/VirtualDisplayService';
import type { DisplayInfo, GamepadInputState } from '../shared/types/ipc';

let mainWindow: BrowserWindow | null = null;
let driverManager: DriverManager;
let virtualController: VirtualControllerService;


const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;



function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        minWidth: 900,
        minHeight: 600,
        frame: false,
        titleBarStyle: 'hidden',
        backgroundColor: '#0a0a0f',
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
            webSecurity: true,
        },
        icon: path.join(__dirname, '../resources/icon.png'),
    });

    // Override CSP at the Electron session level for reliable enforcement (production only)
    // In dev mode, Vite's HMR needs inline scripts/eval, so we rely on the HTML meta tag CSP
    if (!isDev) {
        const relayIp = process.env.VITE_RELAY_IP || '129.159.142.124';
        const csp = [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
            "font-src 'self' https://fonts.gstatic.com",
            "img-src 'self' data: blob: https:",
            "media-src 'self' blob:",
            "worker-src 'self' blob:",
            `connect-src 'self' http://localhost:* ws://localhost:* http://${relayIp}:* ws://${relayIp}:* wss://${relayIp}:* stun: turn: turns:`,
            "object-src 'none'",
            "base-uri 'self'",
            "form-action 'self'",
        ].join('; ');

        mainWindow.webContents.session.webRequest.onHeadersReceived((details, callback) => {
            callback({
                responseHeaders: {
                    ...details.responseHeaders,
                    'Content-Security-Policy': [csp],
                },
            });
        });
    }

    // Load the app
    if (process.env.VITE_DEV_SERVER_URL) {
        mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

async function initializeServices() {
    driverManager = new DriverManager();
    virtualController = new VirtualControllerService();
    const driverStatus = await driverManager.checkDriverStatus();
    console.log('Driver status:', driverStatus);
}

function registerIpcHandlers() {
    ipcMain.handle('system:check-drivers', async () => driverManager.checkDriverStatus());
    ipcMain.handle('system:install-vigembus', async () => driverManager.installViGEmBus());

    ipcMain.handle('system:get-displays', async (): Promise<DisplayInfo[]> => {
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: { width: 0, height: 0 },
        });
        const displays = screen.getAllDisplays();
        return sources.map((source, index) => {
            const display = displays[index] || displays[0];
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

    // System Stats Handler
    let previousCpu = { idle: 0, total: 0 };

    ipcMain.handle('system:get-stats', async () => {
        // Calculate CPU usage
        const cpus = os.cpus();
        let idle = 0;
        let total = 0;

        for (const cpu of cpus) {
            for (const type in cpu.times) {
                total += (cpu.times as any)[type];
            }
            idle += cpu.times.idle;
        }

        let cpuUsage = 0;
        if (previousCpu.total > 0) {
            const diffIdle = idle - previousCpu.idle;
            const diffTotal = total - previousCpu.total;
            if (diffTotal > 0) {
                cpuUsage = Math.round((1 - diffIdle / diffTotal) * 100);
            }
        }
        previousCpu = { idle, total };

        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const memUsage = Math.round(((totalMem - freeMem) / totalMem) * 100);

        return {
            cpuUsage,
            memUsage,
            totalMem: parseFloat((totalMem / (1024 ** 3)).toFixed(1)),
            freeMem: parseFloat((freeMem / (1024 ** 3)).toFixed(1)),
        };
    });

    ipcMain.handle('controller:create-virtual', async () => virtualController.createController());
    ipcMain.handle('controller:destroy-virtual', async () => virtualController.destroyController());
    ipcMain.on('controller:input', (_event, input: GamepadInputState) => virtualController.updateInput(input));

    ipcMain.on('window:minimize', () => mainWindow?.minimize());
    ipcMain.on('window:maximize', () => mainWindow?.isMaximized() ? mainWindow.unmaximize() : mainWindow?.maximize());
    ipcMain.on('window:close', () => mainWindow?.close());

    ipcMain.handle('turn:get-ice-servers', async () => {
        if (selfHostedTurnService.isConfigured()) {
            console.log('[TURN] Using self-hosted TURN server(s)');
            return await selfHostedTurnService.getIceServers();
        }
        console.log('[TURN] No self-hosted TURN configured, using public fallback');
        return [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
            { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
            { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
        ];
    });

    ipcMain.handle('turn:is-configured', () => selfHostedTurnService.isConfigured());

    ipcMain.handle('turn:configure-selfhosted', (_event, serverUrl: string, secret: string) => {
        if (typeof serverUrl !== 'string' || serverUrl.length > 512 ||
            typeof secret !== 'string' || secret.length > 256) {
            throw new Error('Invalid TURN server configuration');
        }
        if (!/^turns?:[\w.-]+:\d+/.test(serverUrl)) throw new Error('Invalid TURN server URL format');
        selfHostedTurnService.configure(serverUrl, secret);
        return { success: true };
    });

    ipcMain.handle('turn:get-status', () => selfHostedTurnService.getStatus());

    ipcMain.handle('app:set-launch-on-startup', (_event, enabled: boolean) => {
        if (typeof enabled !== 'boolean') throw new Error('Invalid argument');
        app.setLoginItemSettings({ openAtLogin: enabled, path: app.getPath('exe') });
        return { success: true };
    });

    ipcMain.handle('turn:run-health-check', async () => {
        await selfHostedTurnService.runHealthChecks();
        return selfHostedTurnService.getStatus();
    });

    ipcMain.on('system:log', (_event, level: string, message: string) => {
        if (!['info', 'warn', 'error'].includes(level)) return;
        if (typeof message !== 'string') return;
        const sanitized = message.slice(0, 2048);
        const prefix = `[Renderer:${level.toUpperCase()}]`;
        if (level === 'error') console.error(prefix, sanitized);
        else if (level === 'warn') console.warn(prefix, sanitized);
        else console.log(prefix, sanitized);
    });

    // ============================================
    // Hardware Capture Handlers
    // ============================================

    ipcMain.handle('hardware-capture:is-supported', async () => {
        const support = await hardwareCaptureService.getEncoderSupport();
        console.log('[Main] Hardware encoder support:', support);
        return support;
    });

    ipcMain.handle('hardware-capture:get-displays', async () => {
        const displays = await hardwareCaptureService.getDisplays();
        console.log('[Main] Available displays for capture:', displays);
        return displays;
    });

    ipcMain.handle('hardware-capture:start', async (_event, settings) => {
        // [SECURITY] Validate all fields before passing to native module
        if (!settings || typeof settings !== 'object') throw new Error('Invalid settings');
        const { displayIndex, fps, bitrate, useHardwareEncoder, codec, bitrateMode } = settings;
        if (typeof displayIndex !== 'number' || displayIndex < 0 || displayIndex > 16) throw new Error('Invalid displayIndex');
        if (typeof fps !== 'number' || fps < 1 || fps > 300) throw new Error('Invalid fps');
        if (typeof bitrate !== 'number' || bitrate < 100_000 || bitrate > 100_000_000) throw new Error('Invalid bitrate');
        if (typeof useHardwareEncoder !== 'boolean') throw new Error('Invalid useHardwareEncoder');
        if (!['h264', 'hevc', 'av1'].includes(codec)) throw new Error('Invalid codec');
        if (!['cbr', 'vbr'].includes(bitrateMode)) throw new Error('Invalid bitrateMode');
        return hardwareCaptureService.start({ displayIndex, fps, bitrate, useHardwareEncoder, codec, bitrateMode });
    });

    ipcMain.handle('hardware-capture:stop', async () => hardwareCaptureService.stop());
    ipcMain.handle('hardware-capture:is-active', async () => hardwareCaptureService.isCaptureActive());
    ipcMain.on('update:restart-and-install', () => autoUpdater.quitAndInstall(false, true));

    hardwareCaptureService.on('frame', (frame) => mainWindow?.webContents.send('hardware-capture:frame', frame));
    hardwareCaptureService.on('audio-frame', (frame) => mainWindow?.webContents.send('hardware-capture:audio-frame', frame));

    ipcMain.handle('hardware-capture:audio-supported', async () => hardwareCaptureService.isAudioSupported());

    ipcMain.handle('hardware-capture:start-audio', async (_event, settings) => {
        if (!settings || typeof settings !== 'object') throw new Error('Invalid settings');
        const { sampleRate, quality } = settings;
        if (typeof sampleRate !== 'number' || ![22050, 44100, 48000].includes(sampleRate)) throw new Error('Invalid sampleRate');
        if (!['low', 'medium', 'high', 'game'].includes(quality)) throw new Error('Invalid quality');
        return hardwareCaptureService.startAudio(sampleRate, quality);
    });

    ipcMain.handle('hardware-capture:stop-audio', async () => hardwareCaptureService.stopAudio());

    ipcMain.handle('virtual-display:get-status', async () => virtualDisplayService.getStatus());
    ipcMain.handle('virtual-display:check-installed', async () => virtualDisplayService.checkInstallation());
    ipcMain.handle('virtual-display:install', async () => virtualDisplayService.installDriver());

    ipcMain.handle('virtual-display:create', async (_event, config) => {
        if (!config || typeof config !== 'object') throw new Error('Invalid config');
        const { width, height, refreshRate } = config;
        if (typeof width !== 'number' || width < 640 || width > 7680) throw new Error('Invalid width');
        if (typeof height !== 'number' || height < 480 || height > 4320) throw new Error('Invalid height');
        if (typeof refreshRate !== 'number' || refreshRate < 24 || refreshRate > 360) throw new Error('Invalid refreshRate');
        return virtualDisplayService.createDisplay({ width, height, refreshRate });
    });

    ipcMain.handle('virtual-display:remove', async (_event, index) => {
        if (typeof index !== 'number' || index < 0 || index > 16) throw new Error('Invalid index');
        return virtualDisplayService.removeDisplay(index);
    });

    ipcMain.handle('virtual-display:remove-all', async () => virtualDisplayService.removeAllDisplays());
}

function validateDeepLink(url: string): string | null {
    if (!url || typeof url !== 'string') return null;
    if (!url.startsWith('titanlink://')) return null;
    try {
        const parsed = new URL(url);
        if (parsed.protocol !== 'titanlink:') return null;
        const allowedHosts = ['join', 'connect', 'invite'];
        if (!allowedHosts.includes(parsed.hostname)) return null;
        return parsed.toString();
    } catch {
        return null;
    }
}

if (process.defaultApp) {
    if (process.argv.length >= 2) {
        app.setAsDefaultProtocolClient('titanlink', process.execPath, [path.resolve(process.argv[1])]);
    }
} else {
    app.setAsDefaultProtocolClient('titanlink');
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
    app.quit();
} else {
    app.on('second-instance', (_event, commandLine) => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) mainWindow.restore();
            mainWindow.focus();
            const rawLink = commandLine.find(arg => arg.startsWith('titanlink://'));
            const deepLink = rawLink ? validateDeepLink(rawLink) : null;
            if (deepLink) mainWindow.webContents.send('app:deep-link', deepLink);
        }
    });

    app.on('open-url', (event, url) => {
        event.preventDefault();
        const deepLink = validateDeepLink(url);
        if (mainWindow && deepLink) mainWindow.webContents.send('app:deep-link', deepLink);
    });

    app.whenReady().then(async () => {
        await initializeServices();
        registerIpcHandlers();
        createWindow();

        if (process.platform === 'win32') {
            const rawLink = process.argv.find(arg => arg.startsWith('titanlink://'));
            const deepLink = rawLink ? validateDeepLink(rawLink) : null;
            if (deepLink && mainWindow) {
                mainWindow.webContents.once('did-finish-load', () => {
                    mainWindow!.webContents.send('app:deep-link', deepLink);
                });
            }
        }

        app.on('activate', () => {
            if (BrowserWindow.getAllWindows().length === 0) createWindow();
        });
    });
}

app.on('window-all-closed', () => {
    virtualController?.destroyController();
    if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', async () => {
    await virtualController?.destroyController();
    await virtualDisplayService.cleanup();
});

import { autoUpdater } from 'electron-updater';
import log from 'electron-log';

log.transports.file.level = 'info';
autoUpdater.logger = log;

const UPDATE_INTERVAL_MS = 60 * 60 * 1000;

autoUpdater.on('checking-for-update', () => {
    log.info('Checking for update...');
    mainWindow?.webContents.send('update:status', 'checking');
});

autoUpdater.on('update-available', (info) => {
    log.info('Update available.', info);
    mainWindow?.webContents.send('update:status', 'available');
});

autoUpdater.on('update-not-available', (info) => {
    log.info('Update not available.', info);
    mainWindow?.webContents.send('update:status', 'not-available');
});

autoUpdater.on('error', (err) => {
    log.error(`Error in auto-updater: ${err}`);
    mainWindow?.webContents.send('update:status', 'error', err.toString());
});

autoUpdater.on('download-progress', (progressObj) => {
    log.info(`Download speed: ${progressObj.bytesPerSecond} - Downloaded ${progressObj.percent}% (${progressObj.transferred}/${progressObj.total})`);
    mainWindow?.webContents.send('update:download-progress', progressObj);
});

autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded', info);
    mainWindow?.webContents.send('update:status', 'downloaded');
});

function initAutoUpdater() {
    if (!app.isPackaged) {
        log.info('App is not packaged, skipping auto-update check.');
        return;
    }
    log.info('Initializing autoUpdater...');
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    try {
        autoUpdater.checkForUpdatesAndNotify();
    } catch (err) {
        log.error('Failed to check for updates on startup:', err);
    }
    setInterval(() => {
        try {
            autoUpdater.checkForUpdatesAndNotify();
        } catch (err) {
            log.error('Periodic update check failed:', err);
        }
    }, UPDATE_INTERVAL_MS);
}

app.on('ready', () => initAutoUpdater());
