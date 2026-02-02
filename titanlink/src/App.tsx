/**
 * TitanLink - Main App Component
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Titlebar } from './components/Titlebar';
import { BackgroundEffects } from './components/BackgroundEffects';
import { LandingPage } from './pages/LandingPage';
import { HostLobby } from './pages/HostLobby';
import { ClientConnect } from './pages/ClientConnect';
import { StreamView } from './pages/StreamView';
import { SettingsPage } from './pages/SettingsPage';
import { ControllerTest } from './pages/ControllerTest';
import { DriverWarning } from './components/DriverWarning';
import { webrtcService } from './services/WebRTCService';
import type { DriverCheckResult, ConnectionState, PeerInfo, StreamSettings } from '../shared/types/ipc';
import { DEFAULT_SETTINGS } from '../shared/types/ipc';

type AppView = 'landing' | 'host-lobby' | 'client-connect' | 'streaming' | 'settings' | 'controller-test';

export interface SessionState {
    sessionCode: string;
    role: 'host' | 'client' | null;
    connectionState: ConnectionState;
    peerInfo?: PeerInfo;
    latency?: number;
}

function App() {
    const [currentView, setCurrentView] = useState<AppView>('landing');
    const [settings, setSettings] = useState<StreamSettings>(DEFAULT_SETTINGS);
    const [sessionState, setSessionState] = useState<SessionState>({
        sessionCode: '',
        role: null,
        connectionState: 'disconnected',
    });
    const [driverStatus, setDriverStatus] = useState<DriverCheckResult | null>(null);
    const [showDriverWarning, setShowDriverWarning] = useState(false);
    const [videoStream, setVideoStream] = useState<MediaStream | null>(null);
    const [error, setError] = useState<string | null>(null);

    // Check driver status on mount
    useEffect(() => {
        const checkDrivers = async () => {
            try {
                if (window.electronAPI?.system) {
                    const status = await window.electronAPI.system.checkDrivers();
                    setDriverStatus(status);
                    if (status.vigembus !== 'installed') {
                        setShowDriverWarning(true);
                    }
                }
            } catch (err) {
                console.error('Error checking drivers:', err);
            }
        };

        checkDrivers();

        // Keyboard shortcut for controller test page (Ctrl+Shift+C)
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey && e.shiftKey && e.key === 'C') {
                e.preventDefault();
                setCurrentView(prev => prev === 'controller-test' ? 'landing' : 'controller-test');
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, []);

    // Update service settings when they change
    useEffect(() => {
        webrtcService.updateSettings(settings);
    }, [settings]);

    // Handle navigation based on connection state
    // Only clients go to streaming view - hosts stay on HostLobby
    useEffect(() => {
        if (sessionState.connectionState === 'streaming' && sessionState.role === 'client') {
            setCurrentView('streaming');
        }
    }, [sessionState.connectionState, sessionState.role]);

    // Create WebRTC callbacks
    const createWebRTCCallbacks = useCallback(() => ({
        onStateChange: (state: ConnectionState) => {
            setSessionState(prev => ({ ...prev, connectionState: state }));
        },
        onPeerConnected: (peer: PeerInfo) => {
            setSessionState(prev => ({ ...prev, peerInfo: peer }));
        },
        onPeerDisconnected: () => {
            setSessionState(prev => ({ ...prev, peerInfo: undefined }));
        },
        onError: (errorMsg: string) => {
            setError(errorMsg);
            console.error('WebRTC Error:', errorMsg);
        },
        onLatencyUpdate: (latency: number) => {
            setSessionState(prev => ({ ...prev, latency }));
        },
        onStreamReceived: (stream: MediaStream) => {
            setVideoStream(stream);
        },
        onInputReceived: (input: any) => {
            // console.log('[App] Input received', input.timestamp);
            // Forward input to StreamView for visualization
            window.dispatchEvent(new CustomEvent('titanlink:input', { detail: input }));

            // CRITICAL: Forward input to the main process for virtual controller injection
            // This is what actually makes the controller work in games!
            if (window.electronAPI?.controller) {
                window.electronAPI.controller.sendInput(input);
            }
        },
        onVideoFrameReceived: (frame: any) => {
            // Forward hardware decoded frame to StreamView for WebCodecs
            window.dispatchEvent(new CustomEvent('titanlink:hardware-frame', { detail: frame }));
        }
    }), []);

    const handleStartHosting = useCallback(async () => {
        // Check driver before hosting (needed for controller emulation)
        if (driverStatus?.vigembus !== 'installed') {
            setShowDriverWarning(true);
            return;
        }
        setCurrentView('host-lobby');
    }, [driverStatus]);

    const handleStartConnecting = useCallback(() => {
        setCurrentView('client-connect');
    }, []);

    const handleOpenSettings = useCallback(() => {
        setCurrentView('settings');
    }, []);

    const startHardwareCapture = async (displayId: string): Promise<void> => {
        if (!settings.useHardwareCapture || !window.electronAPI?.hardwareCapture) return;

        console.log('[App] Starting hardware capture...');
        const displayIndex = parseInt(displayId.split(':')[1]) || 0;

        try {
            const started = await window.electronAPI.hardwareCapture.start({
                displayIndex,
                fps: settings.fps,
                bitrate: settings.bitrate,
                useHardwareEncoder: true
            });

            if (started) {
                console.log('[App] ✓ Hardware capture started');
                window.electronAPI.hardwareCapture.onFrame((frame: any) => {
                    webrtcService.sendVideoFrame(frame);
                });
            } else {
                console.warn('[App] Hardware capture unavailable, using WebRTC fallback');
            }
        } catch (e) {
            console.error('[App] Hardware capture failed:', e);
        }
    };

    const handleHostSession = useCallback(async (displayId: string) => {
        try {
            await window.electronAPI?.controller?.createVirtual();

            // Check if hardware capture is supported (NVENC or software fallback)
            let hwSupported = false;
            if (window.electronAPI?.hardwareCapture) {
                try {
                    const support = await window.electronAPI.hardwareCapture.isSupported();
                    hwSupported = support.nvenc || support.software;
                    console.log('[App] Hardware capture support:', support);
                } catch (e) {
                    console.warn('[App] Failed to check hardware support:', e);
                }
            }

            // Prioritize hardware capture if supported and enabled in settings
            const useHardware = hwSupported && settings.useHardwareCapture;
            console.log(`[App] Using hardware capture: ${useHardware} (Supported: ${hwSupported}, Enabled: ${settings.useHardwareCapture})`);

            const callbacks = createWebRTCCallbacks();
            const sessionCode = await webrtcService.startHosting(displayId, callbacks, false, useHardware);

            if (useHardware) {
                await startHardwareCapture(displayId);
            }

            setSessionState({
                sessionCode,
                role: 'host',
                connectionState: 'waiting-for-peer',
            });

            console.log('[App] Session created:', sessionCode);
            return sessionCode;
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to start hosting';
            setError(message);
            throw err;
        }
    }, [createWebRTCCallbacks, settings]);

    const handleConnectToHost = useCallback(async (sessionCode: string) => {
        try {
            const callbacks = createWebRTCCallbacks();
            await webrtcService.connectToHost(sessionCode, callbacks);

            setSessionState({
                sessionCode,
                role: 'client',
                connectionState: 'connecting',
            });
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to connect';
            setError(message);
            throw err;
        }
    }, [createWebRTCCallbacks]);

    const handleBackToLanding = useCallback(async () => {
        // Cleanup
        await webrtcService.disconnect();

        if (window.electronAPI?.controller) {
            await window.electronAPI.controller.destroyVirtual();
        }

        if (window.electronAPI?.hardwareCapture) {
            await window.electronAPI.hardwareCapture.stop();
        }

        setVideoStream(null);
        setSessionState({
            sessionCode: '',
            role: null,
            connectionState: 'disconnected',
        });
        setError(null);
        setCurrentView('landing');
    }, []);

    const renderView = () => {
        switch (currentView) {
            case 'landing':
                return (
                    <LandingPage
                        onHostClick={handleStartHosting}
                        onConnectClick={handleStartConnecting}
                        onSettingsClick={handleOpenSettings}
                    />
                );
            case 'settings':
                return (
                    <SettingsPage
                        settings={settings}
                        onSave={setSettings}
                        onBack={() => setCurrentView('landing')}
                    />
                );
            case 'host-lobby':
                return (
                    <HostLobby
                        sessionState={sessionState}
                        onStartHosting={handleHostSession}
                        onBack={handleBackToLanding}
                        error={error}
                    />
                );
            case 'client-connect':
                return (
                    <ClientConnect
                        onConnect={handleConnectToHost}
                        onBack={handleBackToLanding}
                        error={error}
                    />
                );
            case 'streaming':
                return (
                    <StreamView
                        sessionState={sessionState}
                        videoStream={videoStream}
                        onDisconnect={handleBackToLanding}
                    />
                );
            case 'controller-test':
                return <ControllerTest />;
            default:
                return null;
        }
    };

    return (
        <>
            <Titlebar />
            <main className="main-content">
                <BackgroundEffects />
                {renderView()}

                {showDriverWarning && (
                    <DriverWarning
                        status={driverStatus}
                        onClose={() => setShowDriverWarning(false)}
                        onInstall={async () => {
                            if (window.electronAPI?.system) {
                                const result = await window.electronAPI.system.installViGEmBus();
                                if (result.success) {
                                    const newStatus = await window.electronAPI.system.checkDrivers();
                                    setDriverStatus(newStatus);
                                    if (newStatus.vigembus === 'installed') {
                                        setShowDriverWarning(false);
                                    }
                                }
                            }
                        }}
                    />
                )}
            </main>
        </>
    );
}

export default App;
