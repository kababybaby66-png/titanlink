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
// Use the StreamService router to cleanly handle WebRTC vs UDP
import { initStreamService, getStreamService } from './services/StreamService';
import type { DriverCheckResult, ConnectionState, PeerInfo, StreamSettings, GamepadInputState } from '../shared/types/ipc';
import { DEFAULT_SETTINGS } from '../shared/types/ipc';

type AppView = 'landing' | 'host-lobby' | 'client-connect' | 'streaming' | 'settings' | 'controller-test';

export interface SessionState {
    sessionCode: string;
    role: 'host' | 'client' | null;
    connectionState: ConnectionState;
    peerInfo?: PeerInfo;
    latency?: number;
}

const SETTINGS_STORAGE_KEY = 'titanlink_settings_v1';

function App() {
    const [currentView, setCurrentView] = useState<AppView>('landing');

    // Initialize settings from localStorage if available
    const [settings, setSettings] = useState<StreamSettings>(() => {
        const saved = localStorage.getItem(SETTINGS_STORAGE_KEY);
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                console.log('[App] Loaded settings from storage:', parsed);
                return { ...DEFAULT_SETTINGS, ...parsed };
            } catch (e) {
                console.error('[App] Failed to parse saved settings:', e);
            }
        }
        return DEFAULT_SETTINGS;
    });

    const [sessionState, setSessionState] = useState<SessionState>({
        sessionCode: '',
        role: null,
        connectionState: 'disconnected',
    });
    const [driverStatus, setDriverStatus] = useState<DriverCheckResult | null>(null);
    const [showDriverWarning, setShowDriverWarning] = useState(false);
    // videoStream removed - UDP protocol uses pure canvas

    const [error, setError] = useState<string | null>(null);
    const [deepLinkCode, setDeepLinkCode] = useState<string | undefined>();

    // Persist settings to localStorage and sync to stream service whenever they change
    useEffect(() => {
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));

        try {
            getStreamService().updateSettings(settings);
        } catch (e) {
            // Service might not be initialized yet, which is fine
        }
    }, [settings]);

    // Sync system-level settings with Main process
    useEffect(() => {
        if (window.electronAPI?.app?.setLaunchOnStartup) {
            window.electronAPI.app.setLaunchOnStartup(settings.launchOnStartup)
                .catch(err => console.error('[App] Failed to set launch on startup:', err));
        }
    }, [settings.launchOnStartup]);

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

    // Handle deep links
    useEffect(() => {
        if (window.electronAPI?.app?.onDeepLink) {
            const cleanup = window.electronAPI.app.onDeepLink((url) => {
                console.log('[App] Received deep link:', url);
                try {
                    if (url.includes('join?code=')) {
                        let code = '';
                        // Sometimes Windows passes the URL format cleanly, sometimes with trailing slashes
                        const idx = url.indexOf('join?code=');
                        let queryParam = url.substring(idx + 10);
                        // Clean up trailing slash from Windows passing uri
                        if (queryParam.endsWith('/')) {
                            queryParam = queryParam.slice(0, -1);
                        }
                        code = queryParam.split('&')[0];

                        if (code) {
                            setDeepLinkCode(code);
                            setCurrentView('client-connect');
                        }
                    }
                } catch (e) {
                    console.error('Error parsing deep link URL', e);
                }
            });
            return cleanup;
        }
    }, []);

    // Handle navigation based on connection state
    // Only clients go to streaming view - hosts stay on HostLobby
    useEffect(() => {
        if (sessionState.connectionState === 'streaming' && sessionState.role === 'client') {
            setCurrentView('streaming');
        }
    }, [sessionState.connectionState, sessionState.role]);

    // Create UDP stream callbacks
    const createUDPCallbacks = useCallback(() => ({
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
            console.error('[UDP Protocol] Error:', errorMsg);
        },
        onLatencyUpdate: (latency: number) => {
            setSessionState(prev => ({ ...prev, latency }));
        },
        // onStreamReceived removed - UDP uses onVideoFrameReceived

        onInputReceived: (input: GamepadInputState) => {
            // console.log('[App] Input received', input.timestamp);
            // Forward input to StreamView for visualization
            window.dispatchEvent(new CustomEvent('titanlink:input', { detail: input }));

            // CRITICAL: Forward input to the main process for virtual controller injection
            // This is what actually makes the controller work in games!
            if (window.electronAPI?.controller) {
                window.electronAPI.controller.sendInput(input);
            }
        },
        onStreamReceived: (stream: MediaStream) => {
            // Wait for App to wire this up, currently only WebRTC uses this
            // We can emit it as a custom event for StreamView to catch
            window.dispatchEvent(new CustomEvent('titanlink:webrtc-stream', { detail: stream }));
        },
        onVideoFrameReceived: (frame: unknown) => {
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

            const callbacks = createUDPCallbacks();
            const streamService = await initStreamService();

            // Ensure service has latest settings
            streamService.updateSettings(settings);

            // StreamService will handle hardware capture initialization internally
            const sessionCode = await streamService.startHosting(displayId, callbacks, false, useHardware);

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
    }, [createUDPCallbacks, settings]);

    const handleConnectToHost = useCallback(async (sessionCode: string) => {
        try {
            const callbacks = createUDPCallbacks();
            const streamService = await initStreamService();

            // Ensure service has latest settings (e.g. for audio/decoder config)
            streamService.updateSettings(settings);

            setSessionState({
                sessionCode,
                role: 'client',
                connectionState: 'connecting',
            });

            await streamService.connectToHost(sessionCode, callbacks);
        } catch (err) {
            const message = err instanceof Error ? err.message : 'Failed to connect';
            setError(message);
            throw err;
        }
    }, [createUDPCallbacks, settings]);

    const handleBackToLanding = useCallback(async () => {
        // Cleanup - only disconnect if service was loaded
        try {
            await getStreamService().disconnect();
        } catch (e) {
            // Not initialized, ignore
        }

        if (window.electronAPI?.controller) {
            await window.electronAPI.controller.destroyVirtual();
        }

        if (window.electronAPI?.hardwareCapture) {
            await window.electronAPI.hardwareCapture.stop();
        }

        // setVideoStream(null); // Removed

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
                        enableBackgroundAnimation={settings.enableBackgroundAnimation}
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
                        enable3D={settings.enable3D}
                    />
                );
            case 'client-connect':
                return (
                    <ClientConnect
                        onConnect={handleConnectToHost}
                        onBack={handleBackToLanding}
                        error={error}
                        initialSessionCode={deepLinkCode}
                    />
                );
            case 'streaming':
                return (
                    <StreamView
                        sessionState={sessionState}
                        onDisconnect={handleBackToLanding}
                    />
                );
            case 'controller-test':
                return <ControllerTest enable3D={settings.enable3D} />;
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
