import React, { useRef, useEffect, useState, useCallback } from 'react';
import type { SessionState } from '../App';
import { webrtcService } from '../services/WebRTCService';
import { setButton, XBOX_BUTTONS } from '../../shared/types/ipc';
import type { GamepadInputState } from '../../shared/types/ipc';
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
    const overlayTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Attach video stream to video element
    useEffect(() => {
        if (videoRef.current && videoStream) {
            videoRef.current.srcObject = videoStream;
        }
    }, [videoStream]);

    // Gamepad polling loop (client only)
    useEffect(() => {
        if (sessionState.role !== 'client') return;
        let animationFrame: number;
        let lastInputState: string = '';

        const pollGamepad = () => {
            const gamepads = navigator.getGamepads();
            const gamepad = gamepads[0];

            if (gamepad) {
                setControllerConnected(true);
                const input: GamepadInputState = {
                    buttons: buildButtonBitfield(gamepad),
                    leftStickX: applyDeadzone(gamepad.axes[0] || 0),
                    leftStickY: applyDeadzone(gamepad.axes[1] || 0),
                    rightStickX: applyDeadzone(gamepad.axes[2] || 0),
                    rightStickY: applyDeadzone(gamepad.axes[3] || 0),
                    leftTrigger: gamepad.buttons[6]?.value || 0,
                    rightTrigger: gamepad.buttons[7]?.value || 0,
                    timestamp: Date.now(),
                };

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
        overlayTimeoutRef.current = setTimeout(() => {
            if (isFullscreen || sessionState.connectionState === 'streaming') {
                setShowOverlay(false);
            }
        }, 3000);
    }, [isFullscreen, sessionState.connectionState]);

    const toggleFullscreen = async () => {
        if (!document.fullscreenElement) {
            await document.documentElement.requestFullscreen();
            setIsFullscreen(true);
        } else {
            await document.exitFullscreen();
            setIsFullscreen(false);
        }
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
            </div>

            {/* HUD OVERLAY */}
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
                    </div>
                </div>

                {/* CONTROLS BOTTOM BAR */}
                <div className="hud-bottom-bar">
                    <CyberButton variant="ghost" size="sm" onClick={toggleFullscreen}>
                        [{isFullscreen ? 'MINIMIZE_VIEW' : 'MAXIMIZE_VIEW'}]
                    </CyberButton>

                    <div className="peer-tag">
                        Connected to: <span className="text-cyan">{sessionState.peerInfo?.username || 'REMOTE_TARGET'}</span>
                    </div>

                    <CyberButton variant="danger" size="sm" onClick={onDisconnect}>
                        TERMINATE_LINK
                    </CyberButton>
                </div>
            </div>
        </div>
    );
}
