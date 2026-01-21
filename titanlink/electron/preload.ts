/**
 * TitanLink - Preload Script
 * Secure bridge between Renderer and Main processes
 */

import { contextBridge, ipcRenderer } from 'electron';
import type {
    DriverCheckResult,
    DisplayInfo,
    GamepadInputState,
} from '../shared/types/ipc';

// Expose protected methods that allow the renderer process to use
// ipcRenderer without exposing the entire object
const electronAPI = {
    // ============================================
    // System APIs
    // ============================================
    system: {
        checkDrivers: (): Promise<DriverCheckResult> =>
            ipcRenderer.invoke('system:check-drivers'),

        installViGEmBus: (): Promise<{ success: boolean; error?: string }> =>
            ipcRenderer.invoke('system:install-vigembus'),

        getDisplays: (): Promise<DisplayInfo[]> =>
            ipcRenderer.invoke('system:get-displays'),
    },

    // ============================================
    // Controller APIs
    // ============================================
    controller: {
        createVirtual: (): Promise<{ success: boolean; error?: string }> =>
            ipcRenderer.invoke('controller:create-virtual'),

        destroyVirtual: (): Promise<void> =>
            ipcRenderer.invoke('controller:destroy-virtual'),

        // Send controller input to main process (host receives from WebRTC, forwards here)
        sendInput: (input: GamepadInputState) =>
            ipcRenderer.send('controller:input', input),
    },

    // ============================================
    // Window Control APIs (Custom Titlebar)
    // ============================================
    window: {
        minimize: () => ipcRenderer.send('window:minimize'),
        maximize: () => ipcRenderer.send('window:maximize'),
        close: () => ipcRenderer.send('window:close'),
    },
};

// Type-safe API exposure
export type ElectronAPI = typeof electronAPI;

contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Also expose for TypeScript type checking in renderer
declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}
