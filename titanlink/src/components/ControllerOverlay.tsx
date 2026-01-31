/**
 * ControllerOverlay - 2D Interactive Controller Visualization
 * TitanLink Cyber-Futuristic Design with SVG
 */

import React from 'react';
import type { GamepadInputState } from '../../shared/types/ipc';
import { isButtonPressed } from '../../shared/types/ipc';
import './ControllerOverlay.css';

interface ControllerOverlayProps {
    input: GamepadInputState | null;
    connected: boolean;
}

export function ControllerOverlay({ input, connected }: ControllerOverlayProps) {
    // Default state when no input
    const state = input || {
        buttons: 0,
        leftStickX: 0,
        leftStickY: 0,
        rightStickX: 0,
        rightStickY: 0,
        leftTrigger: 0,
        rightTrigger: 0,
        timestamp: 0,
    };

    // Parse button states
    const buttonA = isButtonPressed(state.buttons, 'A');
    const buttonB = isButtonPressed(state.buttons, 'B');
    const buttonX = isButtonPressed(state.buttons, 'X');
    const buttonY = isButtonPressed(state.buttons, 'Y');
    const buttonLB = isButtonPressed(state.buttons, 'LB');
    const buttonRB = isButtonPressed(state.buttons, 'RB');
    const buttonBack = isButtonPressed(state.buttons, 'BACK');
    const buttonStart = isButtonPressed(state.buttons, 'START');
    const buttonLS = isButtonPressed(state.buttons, 'LEFT_STICK');
    const buttonRS = isButtonPressed(state.buttons, 'RIGHT_STICK');
    const dpadUp = isButtonPressed(state.buttons, 'DPAD_UP');
    const dpadDown = isButtonPressed(state.buttons, 'DPAD_DOWN');
    const dpadLeft = isButtonPressed(state.buttons, 'DPAD_LEFT');
    const dpadRight = isButtonPressed(state.buttons, 'DPAD_RIGHT');
    const buttonGuide = isButtonPressed(state.buttons, 'GUIDE');

    if (!connected) {
        return (
            <div className="controller-overlay disconnected">
                <div className="controller-icon">🎮</div>
                <span className="controller-status">WAITING FOR INPUT...</span>
            </div>
        );
    }

    return (
        <div className="controller-overlay connected">
            <svg viewBox="0 0 400 200" className="controller-svg">
                {/* Controller Body */}
                <defs>
                    {/* Glow filter for active elements */}
                    <filter id="glow-cyan" x="-50%" y="-50%" width="200%" height="200%">
                        <feGaussianBlur stdDeviation="3" result="blur" />
                        <feMerge>
                            <feMergeNode in="blur" />
                            <feMergeNode in="SourceGraphic" />
                        </feMerge>
                    </filter>
                    <filter id="glow-green" x="-50%" y="-50%" width="200%" height="200%">
                        <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#22ff88" />
                    </filter>
                    <filter id="glow-red" x="-50%" y="-50%" width="200%" height="200%">
                        <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#ff4455" />
                    </filter>
                    <filter id="glow-blue" x="-50%" y="-50%" width="200%" height="200%">
                        <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#4488ff" />
                    </filter>
                    <filter id="glow-yellow" x="-50%" y="-50%" width="200%" height="200%">
                        <feDropShadow dx="0" dy="0" stdDeviation="4" floodColor="#ffaa00" />
                    </filter>

                    {/* Body gradient */}
                    <linearGradient id="bodyGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                        <stop offset="0%" stopColor="#1a1a1e" />
                        <stop offset="100%" stopColor="#0a0a0c" />
                    </linearGradient>
                </defs>

                {/* Main Controller Body */}
                <path
                    d="M50,90 Q50,60 80,50 L150,50 Q170,50 180,60 L220,60 Q230,50 250,50 L320,50 Q350,60 350,90 L350,130 Q350,160 320,170 L280,170 Q260,170 250,150 L150,150 Q140,170 120,170 L80,170 Q50,160 50,130 Z"
                    fill="url(#bodyGradient)"
                    stroke="#00f2ff"
                    strokeWidth="1.5"
                    opacity="0.9"
                />

                {/* Left Trigger */}
                <rect x="65" y="35" width="50" height="12" rx="3" fill="#0a0a0c" stroke="#333" />
                <rect
                    x="65" y="35"
                    width={50 * state.leftTrigger}
                    height="12"
                    rx="3"
                    fill="#00f2ff"
                    filter={state.leftTrigger > 0.1 ? "url(#glow-cyan)" : undefined}
                />
                <text x="90" y="44" fill="#666" fontSize="8" textAnchor="middle">LT</text>

                {/* Right Trigger */}
                <rect x="285" y="35" width="50" height="12" rx="3" fill="#0a0a0c" stroke="#333" />
                <rect
                    x="285" y="35"
                    width={50 * state.rightTrigger}
                    height="12"
                    rx="3"
                    fill="#00f2ff"
                    filter={state.rightTrigger > 0.1 ? "url(#glow-cyan)" : undefined}
                />
                <text x="310" y="44" fill="#666" fontSize="8" textAnchor="middle">RT</text>

                {/* Left Bumper */}
                <rect
                    x="70" y="52"
                    width="45" height="10"
                    rx="2"
                    fill={buttonLB ? "#00f2ff" : "#1a1a1e"}
                    stroke={buttonLB ? "#00f2ff" : "#333"}
                    filter={buttonLB ? "url(#glow-cyan)" : undefined}
                />
                <text x="92" y="60" fill={buttonLB ? "#000" : "#666"} fontSize="7" textAnchor="middle" fontWeight="bold">LB</text>

                {/* Right Bumper */}
                <rect
                    x="285" y="52"
                    width="45" height="10"
                    rx="2"
                    fill={buttonRB ? "#00f2ff" : "#1a1a1e"}
                    stroke={buttonRB ? "#00f2ff" : "#333"}
                    filter={buttonRB ? "url(#glow-cyan)" : undefined}
                />
                <text x="307" y="60" fill={buttonRB ? "#000" : "#666"} fontSize="7" textAnchor="middle" fontWeight="bold">RB</text>

                {/* Left Stick Area */}
                <circle cx="115" cy="95" r="28" fill="#0a0a0c" stroke="#333" strokeWidth="1" />
                <circle cx="115" cy="95" r="20" fill="#151518" stroke="#222" />
                {/* Stick position indicator */}
                <circle
                    cx={115 + state.leftStickX * 12}
                    cy={95 + state.leftStickY * 12}
                    r="12"
                    fill={buttonLS ? "#00f2ff" : "#2a2a2e"}
                    stroke="#00f2ff"
                    strokeWidth={buttonLS ? 2 : 1}
                    filter={buttonLS ? "url(#glow-cyan)" : undefined}
                />

                {/* D-Pad */}
                <g transform="translate(115, 145)">
                    {/* Up */}
                    <rect
                        x="-8" y="-22"
                        width="16" height="14"
                        rx="2"
                        fill={dpadUp ? "#00f2ff" : "#1a1a1e"}
                        stroke="#333"
                        filter={dpadUp ? "url(#glow-cyan)" : undefined}
                    />
                    {/* Down */}
                    <rect
                        x="-8" y="8"
                        width="16" height="14"
                        rx="2"
                        fill={dpadDown ? "#00f2ff" : "#1a1a1e"}
                        stroke="#333"
                        filter={dpadDown ? "url(#glow-cyan)" : undefined}
                    />
                    {/* Left */}
                    <rect
                        x="-22" y="-8"
                        width="14" height="16"
                        rx="2"
                        fill={dpadLeft ? "#00f2ff" : "#1a1a1e"}
                        stroke="#333"
                        filter={dpadLeft ? "url(#glow-cyan)" : undefined}
                    />
                    {/* Right */}
                    <rect
                        x="8" y="-8"
                        width="14" height="16"
                        rx="2"
                        fill={dpadRight ? "#00f2ff" : "#1a1a1e"}
                        stroke="#333"
                        filter={dpadRight ? "url(#glow-cyan)" : undefined}
                    />
                    {/* Center */}
                    <rect x="-8" y="-8" width="16" height="16" fill="#0a0a0c" />
                </g>

                {/* Center Buttons */}
                {/* Back */}
                <rect
                    x="165" y="75"
                    width="20" height="10"
                    rx="2"
                    fill={buttonBack ? "#00f2ff" : "#1a1a1e"}
                    stroke="#333"
                    filter={buttonBack ? "url(#glow-cyan)" : undefined}
                />
                {/* Guide */}
                <circle
                    cx="200" cy="80"
                    r="12"
                    fill={buttonGuide ? "#00f2ff" : "#1a1a1e"}
                    stroke="#00f2ff"
                    strokeWidth={buttonGuide ? 2 : 1}
                    filter={buttonGuide ? "url(#glow-cyan)" : undefined}
                />
                {/* Start */}
                <rect
                    x="215" y="75"
                    width="20" height="10"
                    rx="2"
                    fill={buttonStart ? "#00f2ff" : "#1a1a1e"}
                    stroke="#333"
                    filter={buttonStart ? "url(#glow-cyan)" : undefined}
                />

                {/* Face Buttons */}
                <g transform="translate(285, 95)">
                    {/* Y - Top */}
                    <circle
                        cx="0" cy="-20" r="12"
                        fill={buttonY ? "#ffaa00" : "#1a1a1e"}
                        stroke="#ffaa00"
                        strokeWidth={buttonY ? 2 : 1}
                        filter={buttonY ? "url(#glow-yellow)" : undefined}
                    />
                    <text x="0" y="-16" fill={buttonY ? "#000" : "#ffaa00"} fontSize="10" textAnchor="middle" fontWeight="bold">Y</text>

                    {/* B - Right */}
                    <circle
                        cx="20" cy="0" r="12"
                        fill={buttonB ? "#ff4455" : "#1a1a1e"}
                        stroke="#ff4455"
                        strokeWidth={buttonB ? 2 : 1}
                        filter={buttonB ? "url(#glow-red)" : undefined}
                    />
                    <text x="20" y="4" fill={buttonB ? "#000" : "#ff4455"} fontSize="10" textAnchor="middle" fontWeight="bold">B</text>

                    {/* A - Bottom */}
                    <circle
                        cx="0" cy="20" r="12"
                        fill={buttonA ? "#22ff88" : "#1a1a1e"}
                        stroke="#22ff88"
                        strokeWidth={buttonA ? 2 : 1}
                        filter={buttonA ? "url(#glow-green)" : undefined}
                    />
                    <text x="0" y="24" fill={buttonA ? "#000" : "#22ff88"} fontSize="10" textAnchor="middle" fontWeight="bold">A</text>

                    {/* X - Left */}
                    <circle
                        cx="-20" cy="0" r="12"
                        fill={buttonX ? "#4488ff" : "#1a1a1e"}
                        stroke="#4488ff"
                        strokeWidth={buttonX ? 2 : 1}
                        filter={buttonX ? "url(#glow-blue)" : undefined}
                    />
                    <text x="-20" y="4" fill={buttonX ? "#000" : "#4488ff"} fontSize="10" textAnchor="middle" fontWeight="bold">X</text>
                </g>

                {/* Right Stick Area */}
                <circle cx="240" cy="130" r="24" fill="#0a0a0c" stroke="#333" strokeWidth="1" />
                <circle cx="240" cy="130" r="16" fill="#151518" stroke="#222" />
                {/* Stick position indicator */}
                <circle
                    cx={240 + state.rightStickX * 10}
                    cy={130 + state.rightStickY * 10}
                    r="10"
                    fill={buttonRS ? "#00f2ff" : "#2a2a2e"}
                    stroke="#00f2ff"
                    strokeWidth={buttonRS ? 2 : 1}
                    filter={buttonRS ? "url(#glow-cyan)" : undefined}
                />

                {/* Accent Lines */}
                <line x1="80" y1="68" x2="130" y2="68" stroke="#00f2ff" strokeWidth="1" opacity="0.3" />
                <line x1="270" y1="68" x2="320" y2="68" stroke="#00f2ff" strokeWidth="1" opacity="0.3" />
            </svg>

            {/* Status indicator */}
            <div className="controller-status-badge connected">
                <span className="status-dot"></span>
                <span className="status-text">INPUT ACTIVE</span>
            </div>
        </div>
    );
}

export default ControllerOverlay;
