import React, { useState } from 'react';
import { GlassCard } from '../components/ui/GlassCard';
import type { StreamSettings } from '../../shared/types/ipc';
import './SettingsPage.css';

interface SettingsPageProps {
    settings: StreamSettings;
    onSave: (settings: StreamSettings) => void;
    onBack: () => void;
}

export const SettingsPage: React.FC<SettingsPageProps> = ({ settings, onSave, onBack }) => {
    const [localSettings, setLocalSettings] = useState<StreamSettings>(settings);

    const handleSave = () => {
        onSave(localSettings);
        onBack();
    };

    const updateSetting = <K extends keyof StreamSettings>(key: K, value: StreamSettings[K]) => {
        setLocalSettings(prev => ({ ...prev, [key]: value }));
    };

    return (
        <div className="settings-page">
            <div className="settings-container">
                <GlassCard className="settings-panel">
                    <div className="settings-header">
                        <div className="flex items-center gap-3">
                            <span className="material-symbols-outlined text-primary text-3xl">tune</span>
                            <h2>Settings</h2>
                        </div>
                        <button className="close-btn" onClick={onBack}>
                            <span className="material-symbols-outlined">close</span>
                        </button>
                    </div>

                    <div className="settings-content custom-scrollbar">
                        {/* GENERAL SETTINGS */}
                        <div className="settings-section">
                            <h3 className="section-title">General</h3>
                            <div className="setting-item">
                                <div className="setting-info">
                                    <span className="label">Launch on start</span>
                                    <span className="desc">Start TitanLink automatically when you turn on your PC</span>
                                </div>
                                <label className="cyber-switch">
                                    <input
                                        type="checkbox"
                                        checked={localSettings.launchOnStartup}
                                        onChange={(e) => updateSetting('launchOnStartup', e.target.checked)}
                                    />
                                    <span className="slider"></span>
                                </label>
                            </div>
                            <div className="setting-item">
                                <div className="setting-info">
                                    <span className="label">Hardware acceleration</span>
                                    <span className="desc">Use your graphics card to improve performance</span>
                                </div>
                                <label className="cyber-switch">
                                    <input
                                        type="checkbox"
                                        checked={localSettings.useHardwareCapture}
                                        onChange={(e) => updateSetting('useHardwareCapture', e.target.checked)}
                                    />
                                    <span className="slider"></span>
                                </label>
                            </div>
                            <div className="setting-item">
                                <div className="setting-info">
                                    <span className="label">3D visual effects</span>
                                    <span className="desc">Turn on advanced 3D visual effects</span>
                                </div>
                                <label className="cyber-switch">
                                    <input
                                        type="checkbox"
                                        checked={localSettings.enable3D}
                                        onChange={(e) => updateSetting('enable3D', e.target.checked)}
                                    />
                                    <span className="slider"></span>
                                </label>
                            </div>
                            <div className="setting-item">
                                <div className="setting-info">
                                    <span className="label">Background animations</span>
                                    <span className="desc">Turn on moving background effects for the interface</span>
                                </div>
                                <label className="cyber-switch">
                                    <input
                                        type="checkbox"
                                        checked={localSettings.enableBackgroundAnimation}
                                        onChange={(e) => updateSetting('enableBackgroundAnimation', e.target.checked)}
                                    />
                                    <span className="slider"></span>
                                </label>
                            </div>
                        </div>

                        {/* NETWORK SETTINGS */}
                        <div className="settings-section">
                            <h3 className="section-title">Network</h3>
                            <div className="setting-item">
                                <div className="setting-info">
                                    <span className="label">Automatic port mapping</span>
                                    <span className="desc">Let the app automatically configure your router</span>
                                </div>
                                <label className="cyber-switch">
                                    <input
                                        type="checkbox"
                                        checked={localSettings.enableUpnp}
                                        onChange={(e) => updateSetting('enableUpnp', e.target.checked)}
                                    />
                                    <span className="slider"></span>
                                </label>
                            </div>
                            <div className="input-row">
                                <div className="input-field">
                                    <label>Preferred port</label>
                                    <input
                                        type="number"
                                        className="cyber-input-sm"
                                        value={localSettings.preferredPort}
                                        onChange={(e) => updateSetting('preferredPort', parseInt(e.target.value) || 8000)}
                                    />
                                </div>
                                <div className="input-field">
                                    <label>Bitrate limit (Mbps)</label>
                                    <input
                                        type="number"
                                        className="cyber-input-sm"
                                        value={localSettings.bitrate}
                                        onChange={(e) => updateSetting('bitrate', parseInt(e.target.value) || 10)}
                                    />
                                </div>
                            </div>
                        </div>

                        {/* INPUT SETTINGS */}
                        <div className="settings-section">
                            <h3 className="section-title">Input</h3>
                            <div className="setting-item">
                                <div className="setting-info">
                                    <span className="label">Pass system shortcuts</span>
                                    <span className="desc">Pass shortcuts like Alt+Tab directly to the host PC</span>
                                </div>
                                <label className="cyber-switch">
                                    <input
                                        type="checkbox"
                                        checked={localSettings.immersiveMode}
                                        onChange={(e) => updateSetting('immersiveMode', e.target.checked)}
                                    />
                                    <span className="slider"></span>
                                </label>
                            </div>
                            <div className="input-row">
                                <div className="input-field">
                                    <label>Gamepad emulation</label>
                                    <select
                                        className="cyber-select"
                                        value={localSettings.gamepadEmulation}
                                        onChange={(e) => updateSetting('gamepadEmulation', e.target.value as any)}
                                    >
                                        <option value="xbox">Xbox 360 (ViGEm)</option>
                                        <option value="ds4">DualShock 4</option>
                                        <option value="disabled">Disabled</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* AUDIO SETTINGS */}
                        <div className="settings-section">
                            <h3 className="section-title">Audio</h3>
                            <div className="input-row">
                                <div className="input-field">
                                    <label>Sample rate</label>
                                    <select
                                        className="cyber-select"
                                        value={localSettings.audioSampleRate}
                                        onChange={(e) => updateSetting('audioSampleRate', parseInt(e.target.value) as any)}
                                    >
                                        <option value="48000">48 kHz (High Quality)</option>
                                        <option value="44100">44.1 kHz (Standard)</option>
                                    </select>
                                    <div className="text-[10px] text-white/40 mt-1">
                                        Higher = better quality, more bandwidth
                                    </div>
                                </div>
                                <div className="input-field">
                                    <label>Audio bitrate</label>
                                    <select
                                        className="cyber-select"
                                        value={localSettings.audioBitrate}
                                        onChange={(e) => updateSetting('audioBitrate', parseInt(e.target.value))}
                                    >
                                        <option value="96">96 kbps (Low)</option>
                                        <option value="128">128 kbps (Standard)</option>
                                        <option value="192">192 kbps (High)</option>
                                        <option value="256">256 kbps (Very High)</option>
                                        <option value="320">320 kbps (Maximum)</option>
                                    </select>
                                    <div className="text-[10px] text-white/40 mt-1">
                                        {localSettings.audioBitrate}kbps • Higher = better audio clarity
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* VIDEO SETTINGS */}
                        <div className="settings-section">
                            <h3 className="section-title">Video</h3>
                            <div className="input-row">
                                <div className="input-field">
                                    <label>Resolution</label>
                                    <select
                                        className="cyber-select"
                                        value={localSettings.resolution}
                                        onChange={(e) => updateSetting('resolution', e.target.value as any)}
                                    >
                                        <option value="detect">Auto/Detect Desktop</option>
                                        <option value="1080p">1920x1080 (1080p)</option>
                                        <option value="1440p">2560x1440 (1440p)</option>
                                        <option value="4k">3840x2160 (4K)</option>
                                    </select>
                                </div>
                                <div className="input-field">
                                    <label>Frame rate (Hertz)</label>
                                    <select
                                        className="cyber-select"
                                        value={localSettings.fps}
                                        onChange={(e) => updateSetting('fps', parseInt(e.target.value) as any)}
                                    >
                                        <option value="30">30 Hz</option>
                                        <option value="60">60 Hz</option>
                                        <option value="120">120 Hz</option>
                                        <option value="144">144 Hz</option>
                                        <option value="240">240 Hz</option>
                                    </select>
                                </div>
                                <div className="input-field">
                                    <label>Encoder</label>
                                    <select
                                        className="cyber-select"
                                        value={localSettings.codec}
                                        onChange={(e) => updateSetting('codec', e.target.value as any)}
                                    >
                                        <option value="h264">H.264 (AVC)</option>
                                        <option value="hevc">H.265 (HEVC)</option>
                                        <option value="av1">AV1 (Next Gen)</option>
                                        <option value="vp9">VP9</option>
                                    </select>
                                </div>
                            </div>
                            <div className="setting-item">
                                <div className="setting-info">
                                    <span className="label">VSync (Buffer)</span>
                                    <span className="desc">Prevent screen tearing (may slightly increase delay)</span>
                                </div>
                                <label className="cyber-switch">
                                    <input
                                        type="checkbox"
                                        checked={localSettings.vsync}
                                        onChange={(e) => updateSetting('vsync', e.target.checked)}
                                    />
                                    <span className="slider"></span>
                                </label>
                            </div>
                        </div>

                        {/* ADVANCED NETWORK */}
                        <div className="settings-section">
                            <h3 className="section-title">Advanced Network</h3>
                            <div className="input-row">
                                <div className="input-field">
                                    <label>Bitrate mode</label>
                                    <select
                                        className="cyber-select"
                                        value={localSettings.bitrateMode}
                                        onChange={(e) => updateSetting('bitrateMode', e.target.value as any)}
                                    >
                                        <option value="cbr">CBR (Stable)</option>
                                        <option value="vbr">VBR (Quality)</option>
                                    </select>
                                    <div className="text-[10px] text-white/40 mt-1">
                                        {localSettings.bitrateMode === 'cbr'
                                            ? 'CBR forces consistent quality. Recommended for most connections.'
                                            : 'VBR saves bandwidth on static screens but may pixelate during fast motion.'}
                                    </div>
                                </div>
                                <div className="input-field">
                                    <label>Audio mode</label>
                                    <select
                                        className="cyber-select"
                                        value={localSettings.audioQualityMode}
                                        onChange={(e) => updateSetting('audioQualityMode', e.target.value as any)}
                                    >
                                        <option value="game">Game Audio (High Fidelity)</option>
                                        <option value="voice">Voice (Echo Cancelled)</option>
                                    </select>
                                    <div className="text-[10px] text-white/40 mt-1">
                                        {localSettings.audioQualityMode === 'game'
                                            ? 'Raw audio stream. Best for music/games. Echo cancellation OFF.'
                                            : 'Optimized for speech. Removes background noise and echo.'}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="settings-footer">
                        <span className="version">TitanLink v1.0.4 build 2209</span>
                        <div className="footer-actions">
                            <button className="secondary-btn small" onClick={onBack}>Cancel</button>
                            <button className="primary-btn small" onClick={handleSave}>Apply Changes</button>
                        </div>
                    </div>
                </GlassCard>
            </div>
        </div>
    );
};
