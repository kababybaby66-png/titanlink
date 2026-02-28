import React, { useState } from 'react';
import { GlassCard } from './ui/GlassCard';
import { StatusBadge } from './ui/StatusBadge';
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
    // Audio controls
    volume?: number;
    isMuted?: boolean;
    hasAudio?: boolean;
    onVolumeChange?: (volume: number) => void;
    onMuteToggle?: () => void;
    // Connection quality
    packetLoss?: number;
    jitter?: number;
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
    latency = 0,
    volume = 100,
    isMuted = false,
    hasAudio = false,
    onVolumeChange,
    onMuteToggle,
    packetLoss = 0,
    jitter = 0,
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

    return (
        <div className="quick-menu-overlay">
            {/* BACKDROP */}
            <div className="backdrop" onClick={onClose}></div>

            {/* SIDEBAR DRAWER */}
            <aside className="quick-menu-drawer glass-panel">
                <div className="drawer-header">
                    <div className="flex items-center gap-3">
                        <span className="material-symbols-outlined text-primary animate-spin-slow">settings_motion_mode</span>
                        <h2 className="text-white text-lg font-bold tracking-wide">Quick Menu</h2>
                    </div>
                    <button className="close-btn" onClick={onClose}>
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>

                <div className="drawer-content customs-scrollbar">
                    {/* INPUT CONFIG */}
                    <div className="menu-section">
                        <p className="section-label">Input Config</p>

                        <button className={`menu-item ${showControllerOverlay ? 'active' : ''}`} onClick={onToggleControllerOverlay}>
                            <div className="item-icon-box">
                                <span className="material-symbols-outlined">gamepad</span>
                            </div>
                            <div className="item-details">
                                <p className="label">Controller Overlay</p>
                                <p className="sub">{showControllerOverlay ? 'Visible' : 'Hidden'}</p>
                            </div>
                            <span className="hotkey">C</span>
                        </button>

                        <button className={`menu-item ${isFullscreen ? 'active' : ''}`} onClick={onToggleFullscreen}>
                            <div className="item-icon-box">
                                <span className="material-symbols-outlined">aspect_ratio</span>
                            </div>
                            <div className="item-details">
                                <p className="label">Fullscreen</p>
                                <p className="sub">{isFullscreen ? 'Enabled' : 'Disabled'}</p>
                            </div>
                            <span className="hotkey">F11</span>
                        </button>
                    </div>

                    {/* AUDIO CONTROLS */}
                    <div className="menu-section">
                        <p className="section-label">Audio</p>

                        <button
                            className={`menu-item ${isMuted ? '' : 'active'}`}
                            onClick={onMuteToggle}
                            disabled={!hasAudio}
                        >
                            <div className="item-icon-box">
                                <span className="material-symbols-outlined">
                                    {!hasAudio ? 'volume_off' : isMuted ? 'volume_mute' : 'volume_up'}
                                </span>
                            </div>
                            <div className="item-details">
                                <p className="label">{!hasAudio ? 'Audio Unavailable' : isMuted ? 'Unmute Audio' : 'Mute Audio'}</p>
                                <p className="sub">{!hasAudio ? 'No audio track' : isMuted ? 'Muted' : 'Playing'}</p>
                            </div>
                            <span className="hotkey">M</span>
                        </button>

                        {hasAudio && (
                            <div className="audio-slider-container">
                                <span className="material-symbols-outlined audio-icon">volume_down</span>
                                <input
                                    type="range"
                                    min="0"
                                    max="100"
                                    value={isMuted ? 0 : volume}
                                    onChange={(e) => onVolumeChange?.(parseInt(e.target.value))}
                                    className="audio-slider"
                                    disabled={!hasAudio}
                                />
                                <span className="material-symbols-outlined audio-icon">volume_up</span>
                                <span className="volume-value">{isMuted ? 0 : volume}%</span>
                            </div>
                        )}
                    </div>

                    {/* TELEMETRY */}
                    <div className="menu-section">
                        <p className="section-label">Telemetry</p>
                        <GlassCard className="telemetry-box">
                            <div className="telemetry-row">
                                <span className="label">Latency</span>
                                <div className="flex items-center gap-2">
                                    <StatusBadge status={latency < 50 ? 'online' : latency < 100 ? 'busy' : 'error'} label=" " pulse />
                                    <span className="value-large">{latency}<span className="unit">ms</span></span>
                                </div>
                            </div>
                            <div className="telemetry-details">
                                <span className={packetLoss > 1 ? 'text-warn' : ''}>Loss: {packetLoss}%</span>
                                <span className={jitter > 5 ? 'text-warn' : ''}>Jitter: {jitter}ms</span>
                            </div>
                            {/* Animated Decoration */}
                            <div className="telemetry-anim-bar">
                                <div className="bar-fill"></div>
                            </div>
                        </GlassCard>
                    </div>

                    {/* SESSION INFO */}
                    <div className="menu-section">
                        <p className="section-label">Session Info</p>
                        <div className="session-info-grid">
                            <div className="info-item">
                                <span className="label">Role</span>
                                <span className="value" style={{ textTransform: 'capitalize' }}>{role}</span>
                            </div>
                            {sessionCode && (
                                <div className="info-item">
                                    <span className="label">Code</span>
                                    <span className="value text-primary">{sessionCode}</span>
                                </div>
                            )}
                            <div className="info-item">
                                <span className="label">Audio</span>
                                <span className={`value ${hasAudio ? 'text-success' : 'text-warn'}`}>
                                    {hasAudio ? 'Active' : 'N/A'}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>

                {/* FOOTER */}
                <div className="drawer-footer">
                    <button
                        className={`disconnect-btn ${confirmDisconnect ? 'confirm' : ''}`}
                        onClick={handleDisconnect}
                    >
                        <span className="material-symbols-outlined">power_settings_new</span>
                        <span>{confirmDisconnect ? 'Disconnect?' : 'Disconnect'}</span>
                    </button>
                </div>
            </aside>
        </div>
    );
}
