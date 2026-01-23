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

    // ============================================
    // Signaling Server APIs (Embedded P2P)
    // ============================================
    signaling: {
        start: (): Promise<string> => ipcRenderer.invoke('signaling:start'),
        getUrl: (): Promise<string | null> => ipcRenderer.invoke('signaling:get-url'),
    },

    // ============================================
    // TURN Server APIs (Self-hosted coturn + Twilio fallback)
    // ============================================
    turn: {
        getIceServers: (): Promise<Array<{ urls: string | string[]; username?: string; credential?: string }>> =>
            ipcRenderer.invoke('turn:get-ice-servers'),
        isConfigured: (): Promise<boolean> =>
            ipcRenderer.invoke('turn:is-configured'),
        getStatus: (): Promise<{ selfHosted: boolean; twilio: boolean }> =>
            ipcRenderer.invoke('turn:get-status'),
        configureTwilio: (accountSid: string, authToken: string): Promise<{ success: boolean }> =>
            ipcRenderer.invoke('turn:configure-twilio', accountSid, authToken),
        configureSelfHosted: (serverUrl: string, secret: string): Promise<{ success: boolean }> =>
            ipcRenderer.invoke('turn:configure-selfhosted', serverUrl, secret),
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
