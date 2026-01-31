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

        getStats: (): Promise<any> =>
            ipcRenderer.invoke('system:get-stats'),
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

    // ============================================
    // Signaling Server APIs (Embedded P2P)
    // ============================================
    signaling: {
        start: (): Promise<string> => ipcRenderer.invoke('signaling:start'),
        getUrl: (): Promise<string | null> => ipcRenderer.invoke('signaling:get-url'),
    },

    // ============================================
    // TURN Server APIs (Multi-server with health checking)
    // ============================================
    turn: {
        getIceServers: (): Promise<Array<{ urls: string | string[]; username?: string; credential?: string }>> =>
            ipcRenderer.invoke('turn:get-ice-servers'),
        isConfigured: (): Promise<boolean> =>
            ipcRenderer.invoke('turn:is-configured'),
        getStatus: (): Promise<{ configured: boolean; servers: Array<{ label: string; url: string; healthy: boolean; latencyMs: number }> }> =>
            ipcRenderer.invoke('turn:get-status'),
        runHealthCheck: (): Promise<{ configured: boolean; servers: Array<{ label: string; url: string; healthy: boolean; latencyMs: number }> }> =>
            ipcRenderer.invoke('turn:run-health-check'),
        configureSelfHosted: (serverUrl: string, secret: string): Promise<{ success: boolean }> =>
            ipcRenderer.invoke('turn:configure-selfhosted', serverUrl, secret),
    },

    // ============================================
    // Auto-Updater APIs
    // ============================================
    updater: {
        onStatusChange: (callback: (status: string, error?: string) => void) => {
            const listener = (_event: any, status: string, error?: string) => callback(status, error);
            ipcRenderer.on('update:status', listener);
            return () => { ipcRenderer.removeListener('update:status', listener); };
        },
        restartAndInstall: () => ipcRenderer.send('update:restart-and-install'),
    },

    // ============================================
    // Audio / VB-Cable APIs
    // ============================================
    audio: {
        checkVBCableInstalled: (): Promise<{ installed: boolean; reason?: string }> =>
            ipcRenderer.invoke('audio:check-vbcable-installed'),
        installVBCable: (): Promise<{ success: boolean; error?: string }> =>
            ipcRenderer.invoke('audio:install-vbcable'),
        enableVBCableRouting: (): Promise<{ success: boolean; error?: string }> =>
            ipcRenderer.invoke('audio:enable-vbcable-routing'),
        disableVBCableRouting: (): Promise<{ success: boolean; error?: string }> =>
            ipcRenderer.invoke('audio:disable-vbcable-routing'),
        getDevices: (): Promise<{ devices: Array<{ Name: string; Status: string }>; hasVBCable: boolean }> =>
            ipcRenderer.invoke('audio:get-devices'),
        onVBCableProgress: (callback: (data: { status: string; progress?: number; error?: string }) => void) => {
            const listener = (_event: any, data: { status: string; progress?: number; error?: string }) => callback(data);
            ipcRenderer.on('audio:vbcable-progress', listener);
            return () => { ipcRenderer.removeListener('audio:vbcable-progress', listener); };
        },
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
