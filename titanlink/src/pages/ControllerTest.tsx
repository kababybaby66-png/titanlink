/**
 * Controller Test Page - Temporary debug page for testing 3D controller
 * Uses browser Gamepad API to read local controller input
 */

import React, { useState, useEffect, useRef } from 'react';
import { ControllerOverlay } from '../components/ControllerOverlay';
import type { GamepadInputState } from '../../shared/types/ipc';
import { XBOX_BUTTONS } from '../../shared/types/ipc';
import './ControllerTest.css';

export function ControllerTest() {
    const [input, setInput] = useState<GamepadInputState | null>(null);
    const [connected, setConnected] = useState(false);
    const [gamepadName, setGamepadName] = useState<string>('');
    const animationRef = useRef<number>(0);

    useEffect(() => {
        const pollGamepad = () => {
            const gamepads = navigator.getGamepads();
            const gamepad = gamepads[0] || gamepads[1] || gamepads[2] || gamepads[3];

            if (gamepad) {
                if (!connected) {
                    setConnected(true);
                    setGamepadName(gamepad.id);
                }

                // Convert browser gamepad to our format
                let buttons = 0;

                // Map standard gamepad buttons to Xbox layout
                if (gamepad.buttons[0]?.pressed) buttons |= (1 << XBOX_BUTTONS.A);
                if (gamepad.buttons[1]?.pressed) buttons |= (1 << XBOX_BUTTONS.B);
                if (gamepad.buttons[2]?.pressed) buttons |= (1 << XBOX_BUTTONS.X);
                if (gamepad.buttons[3]?.pressed) buttons |= (1 << XBOX_BUTTONS.Y);
                if (gamepad.buttons[4]?.pressed) buttons |= (1 << XBOX_BUTTONS.LB);
                if (gamepad.buttons[5]?.pressed) buttons |= (1 << XBOX_BUTTONS.RB);
                if (gamepad.buttons[8]?.pressed) buttons |= (1 << XBOX_BUTTONS.BACK);
                if (gamepad.buttons[9]?.pressed) buttons |= (1 << XBOX_BUTTONS.START);
                if (gamepad.buttons[10]?.pressed) buttons |= (1 << XBOX_BUTTONS.LEFT_STICK);
                if (gamepad.buttons[11]?.pressed) buttons |= (1 << XBOX_BUTTONS.RIGHT_STICK);
                if (gamepad.buttons[12]?.pressed) buttons |= (1 << XBOX_BUTTONS.DPAD_UP);
                if (gamepad.buttons[13]?.pressed) buttons |= (1 << XBOX_BUTTONS.DPAD_DOWN);
                if (gamepad.buttons[14]?.pressed) buttons |= (1 << XBOX_BUTTONS.DPAD_LEFT);
                if (gamepad.buttons[15]?.pressed) buttons |= (1 << XBOX_BUTTONS.DPAD_RIGHT);
                if (gamepad.buttons[16]?.pressed) buttons |= (1 << XBOX_BUTTONS.GUIDE);

                // Get trigger values (buttons 6 and 7 on standard gamepad)
                const leftTrigger = gamepad.buttons[6]?.value || 0;
                const rightTrigger = gamepad.buttons[7]?.value || 0;

                setInput({
                    buttons,
                    leftStickX: gamepad.axes[0] || 0,
                    leftStickY: gamepad.axes[1] || 0,
                    rightStickX: gamepad.axes[2] || 0,
                    rightStickY: gamepad.axes[3] || 0,
                    leftTrigger,
                    rightTrigger,
                    timestamp: Date.now(),
                });
            } else {
                if (connected) {
                    setConnected(false);
                    setGamepadName('');
                    setInput(null);
                }
            }

            animationRef.current = requestAnimationFrame(pollGamepad);
        };

        // Start polling
        animationRef.current = requestAnimationFrame(pollGamepad);

        // Gamepad connection events
        const handleConnect = (e: GamepadEvent) => {
            console.log('Gamepad connected:', e.gamepad.id);
            setConnected(true);
            setGamepadName(e.gamepad.id);
        };

        const handleDisconnect = () => {
            console.log('Gamepad disconnected');
            setConnected(false);
            setGamepadName('');
            setInput(null);
        };

        window.addEventListener('gamepadconnected', handleConnect);
        window.addEventListener('gamepaddisconnected', handleDisconnect);

        return () => {
            cancelAnimationFrame(animationRef.current);
            window.removeEventListener('gamepadconnected', handleConnect);
            window.removeEventListener('gamepaddisconnected', handleDisconnect);
        };
    }, [connected]);

    return (
        <div className="controller-test-page">
            <div className="test-header">
                <h1>🎮 Controller Test</h1>
                <p className="subtitle">Press buttons on your controller to see them react</p>
                <button className="back-btn" onClick={() => window.history.back()}>
                    ← Back
                </button>
            </div>

            <div className="test-container">
                <div className="controller-display">
                    <ControllerOverlay input={input} connected={connected} />
                </div>

                <div className="debug-panel">
                    <div className="status-section">
                        <h3>Status</h3>
                        <div className={`connection-status ${connected ? 'connected' : 'disconnected'}`}>
                            <span className="dot"></span>
                            {connected ? 'CONNECTED' : 'WAITING FOR CONTROLLER...'}
                        </div>
                        {gamepadName && (
                            <div className="gamepad-name">{gamepadName}</div>
                        )}
                    </div>

                    {input && (
                        <>
                            <div className="axes-section">
                                <h3>Analog Sticks</h3>
                                <div className="axis-row">
                                    <span>Left X:</span>
                                    <div className="axis-bar">
                                        <div
                                            className="axis-value"
                                            style={{
                                                left: `${50 + input.leftStickX * 50}%`,
                                            }}
                                        />
                                    </div>
                                    <span className="value">{input.leftStickX.toFixed(2)}</span>
                                </div>
                                <div className="axis-row">
                                    <span>Left Y:</span>
                                    <div className="axis-bar">
                                        <div
                                            className="axis-value"
                                            style={{
                                                left: `${50 + input.leftStickY * 50}%`,
                                            }}
                                        />
                                    </div>
                                    <span className="value">{input.leftStickY.toFixed(2)}</span>
                                </div>
                                <div className="axis-row">
                                    <span>Right X:</span>
                                    <div className="axis-bar">
                                        <div
                                            className="axis-value"
                                            style={{
                                                left: `${50 + input.rightStickX * 50}%`,
                                            }}
                                        />
                                    </div>
                                    <span className="value">{input.rightStickX.toFixed(2)}</span>
                                </div>
                                <div className="axis-row">
                                    <span>Right Y:</span>
                                    <div className="axis-bar">
                                        <div
                                            className="axis-value"
                                            style={{
                                                left: `${50 + input.rightStickY * 50}%`,
                                            }}
                                        />
                                    </div>
                                    <span className="value">{input.rightStickY.toFixed(2)}</span>
                                </div>
                            </div>

                            <div className="triggers-section">
                                <h3>Triggers</h3>
                                <div className="trigger-row">
                                    <span>LT:</span>
                                    <div className="trigger-bar">
                                        <div
                                            className="trigger-fill"
                                            style={{ width: `${input.leftTrigger * 100}%` }}
                                        />
                                    </div>
                                    <span className="value">{(input.leftTrigger * 100).toFixed(0)}%</span>
                                </div>
                                <div className="trigger-row">
                                    <span>RT:</span>
                                    <div className="trigger-bar">
                                        <div
                                            className="trigger-fill"
                                            style={{ width: `${input.rightTrigger * 100}%` }}
                                        />
                                    </div>
                                    <span className="value">{(input.rightTrigger * 100).toFixed(0)}%</span>
                                </div>
                            </div>

                            <div className="buttons-section">
                                <h3>Buttons</h3>
                                <div className="button-grid">
                                    {Object.entries(XBOX_BUTTONS).map(([name, bit]) => (
                                        <div
                                            key={name}
                                            className={`button-indicator ${(input.buttons & (1 << bit)) ? 'active' : ''}`}
                                        >
                                            {name}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </>
                    )}

                    {!connected && (
                        <div className="instructions">
                            <p>Connect a controller and press any button to start</p>
                            <p className="hint">Works with Xbox, PlayStation, and most USB controllers</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default ControllerTest;
