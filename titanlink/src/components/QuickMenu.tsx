import React, { useState } from 'react';
import { CyberButton } from './CyberButton';
import './QuickMenu.css';

interface QuickMenuProps {
    isOpen: boolean;
    onClose: () => void;
    onDisconnect: () => void;
    onToggleFullscreen: () => void;
    onToggleControllerOverlay: () => void;
    showControllerOverlay: boolean;
    isFullscreen: boolean;
    sessionCode?: string;
    role: 'host' | 'client' | null;
    latency?: number;
    peerName?: string;
}

export function QuickMenu({
    isOpen,
    onClose,
    onDisconnect,
    onToggleFullscreen,
    onToggleControllerOverlay,
    showControllerOverlay,
    isFullscreen,
    sessionCode,
    role,
    latency,
    peerName,
}: QuickMenuProps) {
    const [confirmDisconnect, setConfirmDisconnect] = useState(false);

    if (!isOpen) return null;

    const handleDisconnect = () => {
        if (confirmDisconnect) {
            onDisconnect();
        } else {
            setConfirmDisconnect(true);
            setTimeout(() => setConfirmDisconnect(false), 3000);
        }
    };

    const handleBackdropClick = (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) {
            onClose();
            setConfirmDisconnect(false);
        }
    };

    return (
        <div className="quick-menu-backdrop" onClick={handleBackdropClick}>
            <div className="quick-menu">
                <div className="quick-menu-header">
                    <div className="menu-title">
                        <span className="menu-icon">⚡</span>
                        TITANLINK CONTROL
                    </div>
                    <button className="close-btn" onClick={onClose}>✕</button>
                </div>

                <div className="quick-menu-content">
                    {/* Session Info */}
                    <div className="menu-section">
                        <div className="section-title">SESSION</div>
                        <div className="session-info">
                            {role === 'host' && sessionCode && (
                                <div className="info-row">
                                    <span className="info-label">CODE</span>
                                    <span className="info-value session-code">{sessionCode}</span>
                                </div>
                            )}
                            <div className="info-row">
                                <span className="info-label">ROLE</span>
                                <span className="info-value">{role?.toUpperCase() || 'UNKNOWN'}</span>
                            </div>
                            {peerName && (
                                <div className="info-row">
                                    <span className="info-label">{role === 'host' ? 'CLIENT' : 'HOST'}</span>
                                    <span className="info-value">{peerName}</span>
                                </div>
                            )}
                            {latency !== undefined && (
                                <div className="info-row">
                                    <span className="info-label">LATENCY</span>
                                    <span className={`info-value ${latency < 50 ? 'good' : latency < 100 ? 'warn' : 'bad'}`}>
                                        {latency}ms
                                    </span>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Display Options */}
                    <div className="menu-section">
                        <div className="section-title">DISPLAY</div>
                        <div className="menu-options">
                            <button
                                className={`option-btn ${isFullscreen ? 'active' : ''}`}
                                onClick={onToggleFullscreen}
                            >
                                <span className="opt-icon">{isFullscreen ? '⊡' : '⊞'}</span>
                                <span>{isFullscreen ? 'EXIT FULLSCREEN' : 'FULLSCREEN'}</span>
                                <span className="hotkey">F11</span>
                            </button>
                            <button
                                className={`option-btn ${showControllerOverlay ? 'active' : ''}`}
                                onClick={onToggleControllerOverlay}
                            >
                                <span className="opt-icon">🎮</span>
                                <span>CONTROLLER VIEW</span>
                                <span className="hotkey">C</span>
                            </button>
                        </div>
                    </div>

                    {/* Hotkeys Reference */}
                    <div className="menu-section">
                        <div className="section-title">HOTKEYS</div>
                        <div className="hotkeys-grid">
                            <div className="hotkey-item">
                                <span className="key">ESC</span>
                                <span className="desc">Toggle Menu</span>
                            </div>
                            <div className="hotkey-item">
                                <span className="key">F11</span>
                                <span className="desc">Fullscreen</span>
                            </div>
                            <div className="hotkey-item">
                                <span className="key">C</span>
                                <span className="desc">Controller View</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="quick-menu-footer">
                    <CyberButton
                        variant={confirmDisconnect ? 'danger' : 'ghost'}
                        onClick={handleDisconnect}
                        className={confirmDisconnect ? 'confirm-disconnect' : ''}
                    >
                        {confirmDisconnect ? '⚠ CONFIRM DISCONNECT?' : 'DISCONNECT'}
                    </CyberButton>
                </div>
            </div>
        </div>
    );
}
