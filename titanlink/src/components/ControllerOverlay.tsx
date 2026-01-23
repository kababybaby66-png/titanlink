import React from 'react';
import type { GamepadInputState } from '../../shared/types/ipc';
import { isButtonPressed } from '../../shared/types/ipc';
import './ControllerOverlay.css';

interface ControllerOverlayProps {
    input: GamepadInputState | null;
    connected: boolean;
}

export function ControllerOverlay({ input, connected }: ControllerOverlayProps) {
    if (!connected || !input) {
        return (
            <div className="controller-overlay disconnected">
                <div className="controller-icon">⭘</div>
                <span className="controller-status">WAITING FOR INPUT...</span>
            </div>
        );
    }

    const { buttons, leftStickX, leftStickY, rightStickX, rightStickY, leftTrigger, rightTrigger } = input;

    // Calculate stick transforms (limit movement to ~15px)
    const stickMove = 12;
    const lStyle = { transform: `translate(${leftStickX * stickMove}px, ${leftStickY * stickMove}px)` };
    const rStyle = { transform: `translate(${rightStickX * stickMove}px, ${rightStickY * stickMove}px)` };

    return (
        <div className="controller-overlay">
            <div className="controller-visual">

                {/* --- TRIGGERS (Visual Bars) --- */}
                <div className="trigger-bar trigger-l">
                    <div className="trigger-val" style={{ width: `${leftTrigger * 100}%` }}></div>
                </div>
                <div className="trigger-bar trigger-r">
                    <div className="trigger-val" style={{ width: `${rightTrigger * 100}%` }}></div>
                </div>

                {/* --- BUMPERS --- */}
                <div className={`bumper bumper-l ${isButtonPressed(buttons, 'LB') ? 'active' : ''}`}>LB</div>
                <div className={`bumper bumper-r ${isButtonPressed(buttons, 'RB') ? 'active' : ''}`}>RB</div>

                {/* --- FACE BUTTONS --- */}
                <div className="face-buttons">
                    <div className={`face-btn btn-y ${isButtonPressed(buttons, 'Y') ? 'active' : ''}`}>Y</div>
                    <div className={`face-btn btn-x ${isButtonPressed(buttons, 'X') ? 'active' : ''}`}>X</div>
                    <div className={`face-btn btn-b ${isButtonPressed(buttons, 'B') ? 'active' : ''}`}>B</div>
                    <div className={`face-btn btn-a ${isButtonPressed(buttons, 'A') ? 'active' : ''}`}>A</div>
                </div>

                {/* --- D-PAD --- */}
                <div className="dpad">
                    <div className="dpad-c"></div>
                    <div className={`dpad-btn dpad-u ${isButtonPressed(buttons, 'DPAD_UP') ? 'active' : ''}`}></div>
                    <div className={`dpad-btn dpad-d ${isButtonPressed(buttons, 'DPAD_DOWN') ? 'active' : ''}`}></div>
                    <div className={`dpad-btn dpad-l ${isButtonPressed(buttons, 'DPAD_LEFT') ? 'active' : ''}`}></div>
                    <div className={`dpad-btn dpad-r ${isButtonPressed(buttons, 'DPAD_RIGHT') ? 'active' : ''}`}></div>
                </div>

                {/* --- STICKS --- */}
                {/* Left Stick (Xbox Layout: High) */}
                <div className="stick-area stick-l">
                    <div
                        className={`stick-head ${isButtonPressed(buttons, 'LEFT_STICK') ? 'clicked' : ''}`}
                        style={lStyle}
                    ></div>
                </div>

                {/* Right Stick (Xbox Layout: Low) */}
                <div className="stick-area stick-r">
                    <div
                        className={`stick-head ${isButtonPressed(buttons, 'RIGHT_STICK') ? 'clicked' : ''}`}
                        style={rStyle}
                    ></div>
                </div>

                {/* --- CENTER --- */}
                <div className="center-stack">
                    <div className={`center-btn ${isButtonPressed(buttons, 'BACK') ? 'active' : ''}`}>◀</div>
                    <div className={`center-btn guide-btn ${isButtonPressed(buttons, 'GUIDE') ? 'active' : ''}`}>⎋</div>
                    <div className={`center-btn ${isButtonPressed(buttons, 'START') ? 'active' : ''}`}>▶</div>
                </div>

            </div>
        </div>
    );
}
