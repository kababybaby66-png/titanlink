/**
 * Vitest Setup File
 * Runs before all tests to configure the testing environment
 */

import { expect, afterEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

// Cleanup after each test case (e.g. clearing jsdom)
afterEach(() => {
    cleanup();
});

// Mock Electron API
global.window.electronAPI = {
    system: {
        checkDrivers: vi.fn(),
        installViGEmBus: vi.fn(),
        getDisplays: vi.fn(),
        getStats: vi.fn(),
    },
    controller: {
        createVirtual: vi.fn(),
        destroyVirtual: vi.fn(),
        sendInput: vi.fn(),
    },
    window: {
        minimize: vi.fn(),
        maximize: vi.fn(),
        close: vi.fn(),
    },
    turn: {
        getIceServers: vi.fn(),
        isConfigured: vi.fn(),
        getStatus: vi.fn(),
        runHealthCheck: vi.fn(),
        configureSelfHosted: vi.fn(),
    },
    updater: {
        onStatusChange: vi.fn(),
        restartAndInstall: vi.fn(),
    },
    audio: {
        checkVBCableInstalled: vi.fn(),
        installVBCable: vi.fn(),
        enableVBCableRouting: vi.fn(),
        disableVBCableRouting: vi.fn(),
        getDevices: vi.fn(),
        onVBCableProgress: vi.fn(),
    },
    hardwareCapture: {
        isSupported: vi.fn(),
        getDisplays: vi.fn(),
        start: vi.fn(),
        stop: vi.fn(),
        isActive: vi.fn(),
        onFrame: vi.fn(),
    },
} as any;

// WebRTC APIs (kept in case any legacy tests still reference them)
// global.RTCPeerConnection = vi.fn() as any;

// Mock MediaStream API
global.MediaStream = vi.fn() as any;
Object.defineProperty(global.navigator, 'mediaDevices', {
    writable: true,
    value: {
        getUserMedia: vi.fn(),
        enumerateDevices: vi.fn(),
    },
});


