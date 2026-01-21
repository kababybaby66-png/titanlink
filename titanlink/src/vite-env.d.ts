/// <reference types="vite/client" />

// Extend Window interface with electronAPI types
import type { ElectronAPI } from '../electron/preload';

declare global {
    interface Window {
        electronAPI: ElectronAPI;
    }
}
