/**
 * TitanLink - Electron Main Process
 * Handles native system access, driver management, and IPC coordination
 * 
 * Note: WebRTC operations happen in the renderer process since they require
 * browser APIs. This main process handles native-only operations.
 */

import { app, BrowserWindow, ipcMain, desktopCapturer, screen } from 'electron';
import path from 'path';
import { DriverManager } from './services/DriverManager';
import { VirtualControllerService } from './services/VirtualControllerService';
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
