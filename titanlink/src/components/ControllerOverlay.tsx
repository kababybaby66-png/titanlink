import React from 'react';
import type { GamepadInputState } from '../../shared/types/ipc';
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

    return (
        <div className="controller-overlay active" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
            <div className="controller-icon" style={{ color: '#00f2ff' }}>🎮</div>
            <span className="controller-status" style={{ color: '#00f2ff' }}>INPUT ACTIVE</span>
            {/* Simple debug values if needed */}
            <div style={{ fontSize: '10px', marginTop: '10px', opacity: 0.7 }}>
                LS: {leftStickX.toFixed(2)}, {leftStickY.toFixed(2)}
            </div>
        </div>
    );
}
