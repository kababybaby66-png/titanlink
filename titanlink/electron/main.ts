/**
 * TitanLink - Electron Main Process
 * Handles native system access, driver management, IPC coordination, and embedded signaling
 */

import { app, BrowserWindow, ipcMain, desktopCapturer, screen } from 'electron';
import path from 'path';
import os from 'os';
import dotenv from 'dotenv';

// Load environment variables from .env file
dotenv.config({ path: path.join(__dirname, '../.env') });
console.log('[Main] Loading .env from:', path.join(__dirname, '../.env'));

// FORCE DISCRETE GPU: Try to force usage of high-performance GPU
// This is critical for NVENC availability on hybrid systems (Optimuss/Muxless)
app.commandLine.appendSwitch('force_high_performance_gpu');
// app.commandLine.appendSwitch('disable-gpu-sandbox'); // Use only if absolutely necessary

// DEBUG: Log environment details to help diagnose native module issues
console.log('[Main] === Environment Debug ===');
console.log(`[Main] Platform: ${process.platform}, Arch: ${process.arch}`);
console.log(`[Main] PATH: ${process.env.PATH}`);
console.log(`[Main] System32 exists: ${require('fs').existsSync('C:\\Windows\\System32')}`);
console.log('[Main] =========================');

import { DriverManager } from './services/DriverManager';
import { VirtualControllerService } from './services/VirtualControllerService';
import { selfHostedTurnService } from './services/SelfHostedTurnService';
import { hardwareCaptureService } from './services/HardwareCaptureService';
import { virtualDisplayService } from './services/VirtualDisplayService';
import type { DisplayInfo, GamepadInputState } from '../shared/types/ipc';

// Keep a global reference of the window object
let mainWindow: BrowserWindow | null = null;

// Services
let driverManager: DriverManager;
let virtualController: VirtualControllerService;


const isDev = process.env.NODE_ENV === 'development' || !app.isPackaged;



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
            nodeIntegration: true,
            contextIsolation: false,
            sandbox: false, // Required for some native modules
        },
        icon: path.join(__dirname, '../resources/icon.png'),
    });

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
            thumbnailSize: { width: 0, height: 0 } // Performance optimization
        });

        const displays = screen.getAllDisplays();

        return sources.map((source, index) => {
            // Match sources to displays roughly by index as desktopCapturer doesn't rely reliably on display ID
            const display = displays[index] || displays[0];
            const scaleFactor = display.scaleFactor || 1;

            // CRITICAL: Return ONLY simple serializable data to avoid "Bad IPC Message" crash
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

        cpus.forEach(cpu => {
            for (const type in cpu.times) {
                total += (cpu.times as any)[type];
            }
            idle += cpu.times.idle;
        });

        let cpuUsage = 0;
        if (previousCpu.total > 0) {
            const diffIdle = idle - previousCpu.idle;
            const diffTotal = total - previousCpu.total;
            if (diffTotal > 0) {
                cpuUsage = Math.round((1 - diffIdle / diffTotal) * 100);
            }
        }
        previousCpu = { idle, total };

        // Memory Usage
        const totalMem = os.totalmem();
        const freeMem = os.freemem();
        const memUsage = Math.round(((totalMem - freeMem) / totalMem) * 100);

        return {
            cpuUsage,
            memUsage,
            totalMem: parseFloat((totalMem / (1024 ** 3)).toFixed(1)),
            freeMem: parseFloat((freeMem / (1024 ** 3)).toFixed(1))
        };
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

    // TURN Server handlers (priority: Self-hosted > Free Public TURN > STUN fallback)
    ipcMain.handle('turn:get-ice-servers', async () => {
        // Priority 1: Self-hosted coturn server(s) with health checking
        if (selfHostedTurnService.isConfigured()) {
            console.log('[TURN] Using self-hosted TURN server(s) with health check');
            return await selfHostedTurnService.getIceServers();
        }

        // Fallback: Free public TURN + STUN (limited but better than nothing)
        console.log('[TURN] No self-hosted TURN configured, using free public TURN fallback');
        return [
            { urls: 'stun:stun.l.google.com:19302' },
            { urls: 'stun:stun1.l.google.com:19302' },
            { urls: 'stun:stun2.l.google.com:19302' },
            // OpenRelay free TURN
            { urls: 'turn:openrelay.metered.ca:80', username: 'openrelayproject', credential: 'openrelayproject' },
            { urls: 'turn:openrelay.metered.ca:443', username: 'openrelayproject', credential: 'openrelayproject' },
            { urls: 'turn:openrelay.metered.ca:443?transport=tcp', username: 'openrelayproject', credential: 'openrelayproject' },
        ];
    });

    ipcMain.handle('turn:is-configured', () => {
        return selfHostedTurnService.isConfigured();
    });

    // Configure self-hosted TURN (coturn)
    ipcMain.handle('turn:configure-selfhosted', (_event, serverUrl: string, secret: string) => {
        selfHostedTurnService.configure(serverUrl, secret);
        return { success: true };
    });

    // Get current TURN configuration status with server health info
    ipcMain.handle('turn:get-status', () => {
        return selfHostedTurnService.getStatus();
    });

    // Launch on startup handler
    ipcMain.handle('app:set-launch-on-startup', (_event, enabled: boolean) => {
        app.setLoginItemSettings({
            openAtLogin: enabled,
            path: app.getPath('exe'),
        });
        console.log(`[Main] Launch on startup sets to: ${enabled}`);
        return { success: true };
    });

    // Force health check on all TURN servers
    ipcMain.handle('turn:run-health-check', async () => {
        await selfHostedTurnService.runHealthChecks();
        return selfHostedTurnService.getStatus();
    });

    // Logging handler - allows renderer to log to main terminal
    ipcMain.on('system:log', (_event, level: 'info' | 'warn' | 'error', message: string) => {
        const prefix = `[Renderer:${level.toUpperCase()}]`;
        if (level === 'error') console.error(prefix, message);
        else if (level === 'warn') console.warn(prefix, message);
        else console.log(prefix, message);
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
        console.log('[Main] Starting hardware capture with settings:', settings);
        const result = hardwareCaptureService.start(settings);
        console.log('[Main] Hardware capture start result:', result);
        return result;
    });

    ipcMain.handle('hardware-capture:stop', async () => {
        console.log('[Main] Stopping hardware capture');
        return hardwareCaptureService.stop();
    });

    ipcMain.handle('hardware-capture:is-active', async () => {
        return hardwareCaptureService.isCaptureActive();
    });

    ipcMain.on('update:restart-and-install', () => {
        autoUpdater.quitAndInstall(false, true);
    });

    // Forward native capture frames to renderer
    hardwareCaptureService.on('frame', (frame) => {
        if (mainWindow) {
            mainWindow.webContents.send('hardware-capture:frame', frame);
        }
    });

    // Forward native audio frames to renderer
    hardwareCaptureService.on('audio-frame', (frame) => {
        if (mainWindow) {
            mainWindow.webContents.send('hardware-capture:audio-frame', frame);
        }
    });

    ipcMain.handle('hardware-capture:audio-supported', async () => {
        return hardwareCaptureService.isAudioSupported();
    });

    ipcMain.handle('hardware-capture:start-audio', async (_event, settings) => {
        console.log('[Main] Starting audio capture:', settings);
        return hardwareCaptureService.startAudio(settings.sampleRate, settings.quality);
    });

    ipcMain.handle('hardware-capture:stop-audio', async () => {
        console.log('[Main] Stopping audio capture');
        return hardwareCaptureService.stopAudio();
    });

    // ============================================
    // Virtual Display Driver Handlers
    // ============================================

    ipcMain.handle('virtual-display:get-status', async () => {
        return virtualDisplayService.getStatus();
    });

    ipcMain.handle('virtual-display:check-installed', async () => {
        return virtualDisplayService.checkInstallation();
    });

    ipcMain.handle('virtual-display:install', async () => {
        return virtualDisplayService.installDriver();
    });

    ipcMain.handle('virtual-display:create', async (_event, config) => {
        console.log('[Main] Creating virtual display:', config);
        return virtualDisplayService.createDisplay(config);
    });

    ipcMain.handle('virtual-display:remove', async (_event, index) => {
        console.log('[Main] Removing virtual display at index:', index);
        return virtualDisplayService.removeDisplay(index);
    });

    ipcMain.handle('virtual-display:remove-all', async () => {
        console.log('[Main] Removing all virtual displays');
        return virtualDisplayService.removeAllDisplays();
    });
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
    await virtualDisplayService.cleanup();
});

// ============================================
// Auto Updater
// ============================================

import { autoUpdater } from 'electron-updater';
import log from 'electron-log';

// Configure logging
log.transports.file.level = 'info';
autoUpdater.logger = log;

// Auto-updater events
autoUpdater.on('checking-for-update', () => {
    log.info('Checking for update...');
    if (mainWindow) mainWindow.webContents.send('update:status', 'checking');
});

autoUpdater.on('update-available', (info) => {
    log.info('Update available.', info);
    if (mainWindow) mainWindow.webContents.send('update:status', 'available');
});

autoUpdater.on('update-not-available', (info) => {
    log.info('Update not available.', info);
    if (mainWindow) mainWindow.webContents.send('update:status', 'not-available');
});

autoUpdater.on('error', (err) => {
    log.error('Error in auto-updater. ' + err);
    if (mainWindow) mainWindow.webContents.send('update:status', 'error', err.toString());
});

autoUpdater.on('download-progress', (progressObj) => {
    let log_message = "Download speed: " + progressObj.bytesPerSecond;
    log_message = log_message + ' - Downloaded ' + progressObj.percent + '%';
    log_message = log_message + ' (' + progressObj.transferred + "/" + progressObj.total + ')';
    log.info(log_message);
    if (mainWindow) mainWindow.webContents.send('update:download-progress', progressObj);
});

autoUpdater.on('update-downloaded', (info) => {
    log.info('Update downloaded', info);
    if (mainWindow) mainWindow.webContents.send('update:status', 'downloaded');
    // Silent update or prompt? 
    // We notify frontend and wait for user click to restart
});

function initAutoUpdater() {
    if (app.isPackaged) {
        log.info('App is packaged, initializing autoUpdater...');
        autoUpdater.autoDownload = true;
        autoUpdater.autoInstallOnAppQuit = true;

        try {
            autoUpdater.checkForUpdatesAndNotify();
        } catch (err) {
            log.error('Failed to check for updates on startup:', err);
        }

        // Check for updates every 1 hour
        setInterval(() => {
            log.info('Periodic update check...');
            try {
                autoUpdater.checkForUpdatesAndNotify();
            } catch (err) {
                log.error('Periodic update check failed:', err);
            }
        }, 60 * 60 * 1000);
    } else {
        log.info('App is not packaged, skipping auto-update check.');
    }
}

// Ensure it connects to ready event (avoiding double triggers via whenReady/onReady if possible)
app.on('ready', () => {
    initAutoUpdater();
});
