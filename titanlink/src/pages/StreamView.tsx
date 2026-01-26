import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { SessionState } from '../App';
import { webrtcService } from '../services/WebRTCService';
import { setButton, XBOX_BUTTONS, isButtonPressed } from '../../shared/types/ipc';
import type { GamepadInputState } from '../../shared/types/ipc';
import { ControllerOverlay } from '../components/ControllerOverlay';
import { FloatingWindow } from '../components/ui/FloatingWindow';
import { QuickMenu } from '../components/QuickMenu';
import './StreamView.css';
import { CyberButton } from '../components/CyberButton';

interface StreamViewProps {
    sessionState: SessionState;
    videoStream: MediaStream | null;
    onDisconnect: () => void;
}

export function StreamView({ sessionState, videoStream, onDisconnect }: StreamViewProps) {
    const videoRef = useRef<HTMLVideoElement>(null);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [showOverlay, setShowOverlay] = useState(true);
    const [controllerConnected, setControllerConnected] = useState(false);
    const [showControllerOverlay, setShowControllerOverlay] = useState(false);
    const [showQuickMenu, setShowQuickMenu] = useState(false);
    const [currentInput, setCurrentInput] = useState<GamepadInputState | null>(null);
    const overlayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const lastGuidePress = useRef<number>(0);

    // Attach video stream to video element
    useEffect(() => {
        if (videoRef.current && videoStream) {
            console.log('[StreamView] Attaching video stream to element', videoStream.id);
            const tracks = videoStream.getVideoTracks();
            console.log(`[StreamView] Stream has ${tracks.length} video tracks`);
            tracks.forEach(t => console.log(`[StreamView] Track ${t.id}: enabled=${t.enabled}, muted=${t.muted}, state=${t.readyState}`));

            videoRef.current.srcObject = videoStream;

            videoRef.current.play().catch(e => {
                console.error('[StreamView] Auto-play failed:', e);
            });

            // Monitor track unexpected ending
            videoStream.getVideoTracks()[0].onended = () => {
                console.warn('[StreamView] Video track ended unexpectedly');
            };
        }
    }, [videoStream]);

    // Keyboard hotkeys
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // ESC - Toggle quick menu
            if (e.key === 'Escape') {
                e.preventDefault();
                setShowQuickMenu(prev => !prev);
            }
            // F11 - Toggle fullscreen
            else if (e.key === 'F11') {
                e.preventDefault();
                toggleFullscreen();
            }
            // C - Toggle controller overlay
            else if (e.key === 'c' || e.key === 'C') {
                if (!showQuickMenu) {
                    setShowControllerOverlay(prev => !prev);
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [showQuickMenu]);

    // Gamepad polling loop (client only)
    useEffect(() => {
        if (sessionState.role !== 'client') return;
        let animationFrame: number;
        let lastInputState: string = '';

        const pollGamepad = () => {
            const gamepads = navigator.getGamepads();
            let gamepad = null;
            // Find first active gamepad
            for (const g of gamepads) {
                if (g && g.connected) {
                    gamepad = g;
                    break;
                }
            }

            if (gamepad) {
                setControllerConnected(true);
                const input: GamepadInputState = {
                    buttons: buildButtonBitfield(gamepad),
                    leftStickX: applyDeadzone(gamepad.axes[0] || 0),
                    leftStickY: applyDeadzone(gamepad.axes[1] || 0),
                    rightStickX: applyDeadzone(gamepad.axes[2] || 0),
                    rightStickY: applyDeadzone(gamepad.axes[3] || 0),
                    leftTrigger: gamepad.buttons[6]?.value || (gamepad.buttons[6]?.pressed ? 1.0 : 0),
                    rightTrigger: gamepad.buttons[7]?.value || (gamepad.buttons[7]?.pressed ? 1.0 : 0),
                    timestamp: Date.now(),
                };

                // Update current input for controller overlay
                setCurrentInput(input);

                // Check for Guide button double-tap to toggle quick menu
                if (isButtonPressed(input.buttons, 'GUIDE')) {
                    const now = Date.now();
                    if (now - lastGuidePress.current < 500 && now - lastGuidePress.current > 50) {
                        setShowQuickMenu(prev => !prev);
                        lastGuidePress.current = 0; // Reset to prevent triple-tap
                    } else {
                        lastGuidePress.current = now;
                    }
                }

                const stateKey = JSON.stringify({
                    buttons: input.buttons,
                    lx: Math.round(input.leftStickX * 100),
                    ly: Math.round(input.leftStickY * 100),
                    rx: Math.round(input.rightStickX * 100),
                    ry: Math.round(input.rightStickY * 100),
                    lt: Math.round(input.leftTrigger * 100),
                    rt: Math.round(input.rightTrigger * 100),
                });

                if (stateKey !== lastInputState) {
                    lastInputState = stateKey;
                    webrtcService.sendInput(input);
                }
            } else {
                setControllerConnected(false);
                setCurrentInput(null);
            }
            animationFrame = requestAnimationFrame(pollGamepad);
        };

        animationFrame = requestAnimationFrame(pollGamepad);
        const handleConnect = () => setControllerConnected(true);
        const handleDisconnect = () => setControllerConnected(false);
        window.addEventListener('gamepadconnected', handleConnect);
        window.addEventListener('gamepaddisconnected', handleDisconnect);

        return () => {
            cancelAnimationFrame(animationFrame);
            window.removeEventListener('gamepadconnected', handleConnect);
            window.removeEventListener('gamepaddisconnected', handleDisconnect);
        };
    }, [sessionState.role]);

    // Host receives input and can display it
    useEffect(() => {
        if (sessionState.role !== 'host') return;

        const handleInputReceived = (input: GamepadInputState) => {
            setCurrentInput(input);
            setControllerConnected(true);
        };

        // Subscribe to input events from WebRTC service
        // This is handled through the callbacks in App.tsx
        // We'll use a custom event for this
        const handler = (e: CustomEvent<GamepadInputState>) => handleInputReceived(e.detail);
        window.addEventListener('titanlink:input' as any, handler);

        return () => {
            window.removeEventListener('titanlink:input' as any, handler);
        };
    }, [sessionState.role]);

    // Helpers
    const buildButtonBitfield = (gamepad: Gamepad): number => {
        let buttons = 0;
        const map = [
            'A', 'B', 'X', 'Y', 'LB', 'RB', undefined, undefined, 'BACK', 'START',
            'LEFT_STICK', 'RIGHT_STICK', 'DPAD_UP', 'DPAD_DOWN', 'DPAD_LEFT', 'DPAD_RIGHT', 'GUIDE'
        ];
        map.forEach((btn, idx) => {
            if (btn && gamepad.buttons[idx]?.pressed) buttons = setButton(buttons, btn as keyof typeof XBOX_BUTTONS, true);
        });
        return buttons;
    };

    const applyDeadzone = (value: number, deadzone: number = 0.1): number => {
        return Math.abs(value) < deadzone ? 0 : value;
    };

    // Auto-hide overlay
    const handleMouseMove = useCallback(() => {
        setShowOverlay(true);
        if (overlayTimeoutRef.current) clearTimeout(overlayTimeoutRef.current);

        // User requested overlay to show always ("it should show always")
        // We only hide the cursor if needed, but for now we keep the overlay active
        /* 
        overlayTimeoutRef.current = setTimeout(() => {
            if ((isFullscreen || sessionState.connectionState === 'streaming') && !showQuickMenu) {
                setShowOverlay(false);
            }
        }, 3000);
        */
    }, [isFullscreen, sessionState.connectionState, showQuickMenu]);

    const toggleFullscreen = async () => {
        if (!document.fullscreenElement) {
            await document.documentElement.requestFullscreen();
            setIsFullscreen(true);
        } else {
            await document.exitFullscreen();
            setIsFullscreen(false);
        }
    };

    // Desktop Window State (Client Only)
    const [windows, setWindows] = useState({
        stats: false,
        controller: false,
        debug: false,
    });
    const [activeWindow, setActiveWindow] = useState<string | null>(null);

    const toggleWindow = (name: keyof typeof windows) => {
        setWindows(prev => ({ ...prev, [name]: !prev[name] }));
        if (!windows[name]) setActiveWindow(name);
    };

    const bringToFront = (name: string) => {
        setActiveWindow(name);
    };

    return (
        <div
            className={`stream-view ${showOverlay ? 'overlay-active' : 'overlay-hidden'}`}
            onMouseMove={handleMouseMove}
        >
            <div className="stream-video-wrapper">
                <video
                    ref={videoRef}
                    className="stream-video"
                    autoPlay
                    playsInline
                    muted={sessionState.role === 'host'}
                />
                {sessionState.role === 'host' && (
                    <div className="host-broadcast-indicator">
                        <div className="broadcast-icon">📡</div>
                        <div className="broadcast-text">UPLINK ESTABLISHED</div>
                        <div className="broadcast-sub">Transmitting Data to Client</div>
                    </div>
                )}
            </div>

            {/* --- CLIENT DESKTOP INTERFACE --- */}
            {sessionState.role === 'client' ? (
                <div className="client-desktop-interface">
                    {/* Top Menu Bar / Dock */}
                    <div className={`desktop-dock ${!showOverlay ? 'hidden' : ''}`}>
                        <div className="dock-left">
                            <div className="dock-logo">TitanLink OS</div>
                            <div className="dock-divider"></div>
                            <button
                                className={`dock-btn ${windows.stats ? 'active' : ''}`}
                                onClick={() => toggleWindow('stats')}
                                title="Network Statistics"
                            >
                                <span className="material-symbols-outlined">speed</span>
                            </button>
                            <button
                                className={`dock-btn ${windows.controller ? 'active' : ''}`}
                                onClick={() => toggleWindow('controller')}
                                title="Controller Input"
                            >
                                <span className="material-symbols-outlined">gamepad</span>
                            </button>
                            <button
                                className={`dock-btn ${windows.debug ? 'active' : ''}`}
                                onClick={() => toggleWindow('debug')}
                                title="Debug Log"
                            >
                                <span className="material-symbols-outlined">terminal</span>
                            </button>
                        </div>

                        <div className="dock-right">
                            <div className="connection-pill">
                                <div className={`status-dot ${sessionState.connectionState === 'streaming' ? 'green' : 'red'}`}></div>
                                <span>{sessionState.latency || 0} ms</span>
                            </div>
                            <button className="dock-btn danger" onClick={onDisconnect} title="Disconnect">
                                <span className="material-symbols-outlined">power_settings_new</span>
                            </button>
                            <button className="dock-btn" onClick={toggleFullscreen} title="Toggle Fullscreen">
                                <span className="material-symbols-outlined">{isFullscreen ? 'fullscreen_exit' : 'fullscreen'}</span>
                            </button>
                        </div>
                    </div>

                    {/* Windows */}
                    {windows.stats && (
                        <FloatingWindow
                            title="Network Statistics"
                            onClose={() => toggleWindow('stats')}
                            icon="speed"
                            initialPosition={{ x: 20, y: 80 }}
                            isActive={activeWindow === 'stats'}
                            onFocus={() => bringToFront('stats')}
                        >
                            <div className="window-padding">
                                <div className="stat-row">
                                    <span className="label">Latency</span>
                                    <span className="value">{sessionState.latency || 0} ms</span>
                                </div>
                                <div className="stat-row">
                                    <span className="label">Resolution</span>
                                    <span className="value">{videoRef.current?.videoWidth}x{videoRef.current?.videoHeight}</span>
                                </div>
                                <div className="stat-row">
                                    <span className="label">Protocol</span>
                                    <span className="value">WebRTC/UDP</span>
                                </div>
                            </div>
                        </FloatingWindow>
                    )}

                    {windows.controller && (
                        <FloatingWindow
                            title="Controller Input"
                            onClose={() => toggleWindow('controller')}
                            icon="gamepad"
                            initialPosition={{ x: 340, y: 80 }}
                            initialSize={{ width: 400, height: 250 }}
                            isActive={activeWindow === 'controller'}
                            onFocus={() => bringToFront('controller')}
                            className="no-padding"
                        >
                            <div className="window-controller-wrapper">
                                <ControllerOverlay input={currentInput} connected={controllerConnected} />
                            </div>
                        </FloatingWindow>
                    )}

                    {windows.debug && (
                        <FloatingWindow
                            title="System Log"
                            onClose={() => toggleWindow('debug')}
                            icon="terminal"
                            initialPosition={{ x: 20, y: 400 }}
                            initialSize={{ width: 500, height: 200 }}
                            isActive={activeWindow === 'debug'}
                            onFocus={() => bringToFront('debug')}
                        >
                            <div className="debug-log-content">
                                <div className="log-line">[SYSTEM] Desktop Environment Loaded</div>
                                <div className="log-line">[NETWORK] Connected to Host</div>
                                <div className="log-line">[VIDEO] Stream Active</div>
                            </div>
                        </FloatingWindow>
                    )}
                </div>
            ) : (
                /* --- HOST HUD (Original) --- */
                <div className="hud-overlay">
                    {/* HUD CORNERS */}
                    <div className="hud-corner top-left"></div>
                    <div className="hud-corner top-right"></div>
                    <div className="hud-corner bottom-left"></div>
                    <div className="hud-corner bottom-right"></div>

                    {/* TELEMETRY TOP BAR */}
                    <div className="hud-top-bar">
                        <div className="connection-status">
                            <div className={`status-led ${sessionState.connectionState === 'streaming' ? 'stable' : 'warn'}`}></div>
                            <span className="mono-text">UPLINK_STABLE</span>
                        </div>

                        <div className="telemetry-grid">
                            <div className="telemetry-item">
                                <span className="t-label">PING</span>
                                <span className={`t-val ${sessionState.latency && sessionState.latency < 50 ? 'text-cyan' : 'text-warn'}`}>
                                    {sessionState.latency || 0} MS
                                </span>
                            </div>
                            <div className="telemetry-item">
                                <span className="t-label">CTRL</span>
                                <span className={`t-val ${controllerConnected ? 'text-success' : 'text-dim'}`}>
                                    {controllerConnected ? 'ENGAGED' : 'NO_SIGNAL'}
                                </span>
                            </div>
                            {sessionState.role === 'host' && sessionState.sessionCode && (
                                <div className="telemetry-item session-code-display">
                                    <span className="t-label">CODE</span>
                                    <span className="t-val text-cyan session-code-value">{sessionState.sessionCode}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Controller Overlay (bottom-right) */}
                    {showControllerOverlay && (
                        <div className="controller-overlay-container">
                            <ControllerOverlay input={currentInput} connected={controllerConnected} />
                        </div>
                    )}

                    {/* CONTROLS BOTTOM BAR */}
                    <div className="hud-bottom-bar">
                        <CyberButton variant="ghost" size="sm" onClick={() => setShowQuickMenu(true)}>
                            [MENU]
                        </CyberButton>
                        <div className="peer-tag">
                            Hosting Session: <span className="text-cyan">{sessionState.peerInfo?.username || 'REMOTE_TARGET'}</span>
                        </div>

                        <CyberButton
                            variant="ghost"
                            size="sm"
                            onClick={() => setShowControllerOverlay(prev => !prev)}
                            className={showControllerOverlay ? 'active' : ''}
                            title="Toggle Controller Overlay"
                        >
                            [🎮]
                        </CyberButton>

                        <CyberButton variant="danger" size="sm" onClick={onDisconnect}>
                            STOP_STREAM
                        </CyberButton>
                    </div>

                    {/* ESC hint */}
                    <div className="esc-hint">
                        Press <span className="key">ESC</span> for menu
                    </div>
                </div>
            )}

            {/* Quick Menu Overlay - Only for Host, Client uses dock/windows now */}
            {sessionState.role === 'host' && (
                <QuickMenu
                    isOpen={showQuickMenu}
                    onClose={() => setShowQuickMenu(false)}
                    onDisconnect={onDisconnect}
                    onToggleFullscreen={toggleFullscreen}
                    onToggleControllerOverlay={() => setShowControllerOverlay(prev => !prev)}
                    showControllerOverlay={showControllerOverlay}
                    isFullscreen={isFullscreen}
                    sessionCode={sessionState.sessionCode}
                    role={sessionState.role}
                    latency={sessionState.latency}
                    peerName={sessionState.peerInfo?.username}
                />
            )}
        </div>
    );
}
