import React from 'react';
import type { GamepadInputState } from '../../shared/types/ipc';
import { XBOX_BUTTONS, isButtonPressed } from '../../shared/types/ipc';
import './ControllerOverlay.css';

interface ControllerOverlayProps {
    input: GamepadInputState | null;
    connected: boolean;
}

export function ControllerOverlay({ input, connected }: ControllerOverlayProps) {
    if (!connected || !input) {
        return (
            <div className="controller-overlay disconnected">
                <div className="controller-icon">🎮</div>
                <span className="controller-status">NO CONTROLLER</span>
            </div>
        );
    }

    const buttons = input.buttons;

    return (
        <div className="controller-overlay">
            <div className="controller-visual">
                {/* Face Buttons */}
                <div className="button-cluster face-buttons">
                    <div className={`btn btn-y ${isButtonPressed(buttons, 'Y') ? 'active' : ''}`}>Y</div>
                    <div className="btn-row">
                        <div className={`btn btn-x ${isButtonPressed(buttons, 'X') ? 'active' : ''}`}>X</div>
                        <div className={`btn btn-b ${isButtonPressed(buttons, 'B') ? 'active' : ''}`}>B</div>
                    </div>
                    <div className={`btn btn-a ${isButtonPressed(buttons, 'A') ? 'active' : ''}`}>A</div>
                </div>

                {/* D-Pad */}
                <div className="button-cluster dpad">
                    <div className={`btn dpad-btn ${isButtonPressed(buttons, 'DPAD_UP') ? 'active' : ''}`}>▲</div>
                    <div className="btn-row">
                        <div className={`btn dpad-btn ${isButtonPressed(buttons, 'DPAD_LEFT') ? 'active' : ''}`}>◀</div>
                        <div className={`btn dpad-btn ${isButtonPressed(buttons, 'DPAD_RIGHT') ? 'active' : ''}`}>▶</div>
                    </div>
                    <div className={`btn dpad-btn ${isButtonPressed(buttons, 'DPAD_DOWN') ? 'active' : ''}`}>▼</div>
                </div>

                {/* Sticks */}
                <div className="sticks-row">
                    <div className="stick-container">
                        <div className="stick-bg">
                            <div
                                className={`stick-dot ${isButtonPressed(buttons, 'LEFT_STICK') ? 'pressed' : ''}`}
                                style={{
                                    transform: `translate(${input.leftStickX * 12}px, ${input.leftStickY * 12}px)`
                                }}
                            />
                        </div>
                        <span className="stick-label">L</span>
                    </div>
                    <div className="stick-container">
                        <div className="stick-bg">
                            <div
                                className={`stick-dot ${isButtonPressed(buttons, 'RIGHT_STICK') ? 'pressed' : ''}`}
                                style={{
                                    transform: `translate(${input.rightStickX * 12}px, ${input.rightStickY * 12}px)`
                                }}
                            />
                        </div>
                        <span className="stick-label">R</span>
                    </div>
                </div>

                {/* Triggers & Bumpers */}
                <div className="triggers-row">
                    <div className="trigger-group">
                        <div className={`bumper ${isButtonPressed(buttons, 'LB') ? 'active' : ''}`}>LB</div>
                        <div className="trigger">
                            <div className="trigger-fill" style={{ height: `${input.leftTrigger * 100}%` }} />
                            <span>LT</span>
                        </div>
                    </div>
                    <div className="center-btns">
                        <div className={`btn small-btn ${isButtonPressed(buttons, 'BACK') ? 'active' : ''}`}>⊲</div>
                        <div className={`btn small-btn guide ${isButtonPressed(buttons, 'GUIDE') ? 'active' : ''}`}>⊙</div>
                        <div className={`btn small-btn ${isButtonPressed(buttons, 'START') ? 'active' : ''}`}>⊳</div>
                    </div>
                    <div className="trigger-group">
                        <div className={`bumper ${isButtonPressed(buttons, 'RB') ? 'active' : ''}`}>RB</div>
                        <div className="trigger">
                            <div className="trigger-fill" style={{ height: `${input.rightTrigger * 100}%` }} />
                            <span>RT</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
