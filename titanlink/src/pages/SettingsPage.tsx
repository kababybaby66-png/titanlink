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
                            <h2>SYSTEM CONFIGURATION</h2>
                        </div>
                        <button className="close-btn" onClick={onBack}>
                            <span className="material-symbols-outlined">close</span>
                        </button>
                    </div>

                    <div className="settings-content custom-scrollbar">
                        {/* GENERAL SETTINGS */}
                        <div className="settings-section">
                            <h3 className="section-title">GENERAL</h3>
                            <div className="setting-item">
                                <div className="setting-info">
                                    <span className="label">Launch on Startup</span>
                                    <span className="desc">Automatically initialize daemon on system boot</span>
                                </div>
                                <label className="cyber-switch">
                                    <input type="checkbox" defaultChecked />
                                    <span className="slider"></span>
                                </label>
                            </div>
                            <div className="setting-item">
                                <div className="setting-info">
                                    <span className="label">Hardware Acceleration</span>
                                    <span className="desc">Use GPU for encoding/decoding</span>
                                </div>
                                <label className="cyber-switch">
                                    <input type="checkbox" defaultChecked />
                                    <span className="slider"></span>
                                </label>
                            </div>
                        </div>

                        {/* NETWORK SETTINGS */}
                        <div className="settings-section">
                            <h3 className="section-title">NETWORK</h3>
                            <div className="setting-item">
                                <div className="setting-info">
                                    <span className="label">UPnP Port Mapping</span>
                                    <span className="desc">Automatically configure router ports</span>
                                </div>
                                <label className="cyber-switch">
                                    <input type="checkbox" defaultChecked />
                                    <span className="slider"></span>
                                </label>
                            </div>
                            <div className="input-row">
                                <div className="input-field">
                                    <label>Preferred Port</label>
                                    <input type="text" className="cyber-input-sm" defaultValue="8000" />
                                </div>
                                <div className="input-field">
                                    <label>Bitrate Limit (Mbps)</label>
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
                            <h3 className="section-title">INPUT</h3>
                            <div className="setting-item">
                                <div className="setting-info">
                                    <span className="label">Immersive Mode</span>
                                    <span className="desc">Pass Windows hotkeys (Alt+Tab) to host</span>
                                </div>
                                <label className="cyber-switch">
                                    <input type="checkbox" defaultChecked />
                                    <span className="slider"></span>
                                </label>
                            </div>
                            <div className="input-row">
                                <div className="input-field">
                                    <label>Gamepad Emulation</label>
                                    <select className="cyber-select">
                                        <option>Xbox 360 (ViGEm)</option>
                                        <option>DualShock 4</option>
                                        <option>Disabled</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* AUDIO SETTINGS */}
                        <div className="settings-section">
                            <h3 className="section-title">AUDIO</h3>
                            <div className="input-row">
                                <div className="input-field">
                                    <label>Audio Device</label>
                                    <select className="cyber-select">
                                        <option>Default Output Device</option>
                                        <option>Headphones (Realtek High Definition)</option>
                                    </select>
                                </div>
                                <div className="input-field">
                                    <label>Quality</label>
                                    <select className="cyber-select">
                                        <option>High (48kHz)</option>
                                        <option>Low (Bandwidth Saver)</option>
                                    </select>
                                </div>
                            </div>
                        </div>

                        {/* VIDEO SETTINGS */}
                        <div className="settings-section">
                            <h3 className="section-title">VIDEO</h3>
                            <div className="input-row">
                                <div className="input-field">
                                    <label>Resolution</label>
                                    <select
                                        className="cyber-select"
                                        value={localSettings.resolution}
                                        onChange={(e) => updateSetting('resolution', e.target.value as any)}
                                    >
                                        <option value="1080p">1920x1080 (1080p)</option>
                                        <option value="1440p">2560x1440 (1440p)</option>
                                        <option value="4k">3840x2160 (4K)</option>
                                    </select>
                                </div>
                                <div className="input-field">
                                    <label>Frame Rate (Hertz)</label>
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
                                        <option value="h265">H.265 (HEVC)</option>
                                        <option value="h264">H.264 (AVC)</option>
                                        <option value="vp9">VP9 (AV1)</option>
                                    </select>
                                </div>
                            </div>
                            <div className="setting-item">
                                <div className="setting-info">
                                    <span className="label">VSync (Buffer)</span>
                                    <span className="desc">Reduces tearing, increases latency</span>
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
                            <h3 className="section-title">ADVANCED NETWORK</h3>
                            <div className="input-row">
                                <div className="input-field">
                                    <label>Bitrate Mode</label>
                                    <div className="flex gap-2">
                                        <button
                                            className={`flex-1 px-3 py-2 text-xs font-bold rounded ${localSettings.bitrateMode === 'cbr' ? 'bg-primary text-black' : 'bg-white/5 text-white/60'}`}
                                            onClick={() => updateSetting('bitrateMode', 'cbr')}
                                            title="Constant Bitrate: Maintains a steady data stream. Better for consistency and preventing lag spikes."
                                        >
                                            CBR (Stable)
                                        </button>
                                        <button
                                            className={`flex-1 px-3 py-2 text-xs font-bold rounded ${localSettings.bitrateMode === 'vbr' ? 'bg-primary text-black' : 'bg-white/5 text-white/60'}`}
                                            onClick={() => updateSetting('bitrateMode', 'vbr')}
                                            title="Variable Bitrate: Adjusts bandwidth usage based on complexity. Can look better but might cause spikes."
                                        >
                                            VBR (Quality)
                                        </button>
                                    </div>
                                    <div className="text-[10px] text-white/40 mt-1">
                                        {localSettings.bitrateMode === 'cbr'
                                            ? 'CBR forces consistent quality. Recommended for most connections.'
                                            : 'VBR saves bandwidth on static screens but may pixelate during fast motion.'}
                                    </div>
                                </div>
                                <div className="input-field">
                                    <label>Audio Mode</label>
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
                            <button className="secondary-btn small" onClick={onBack}>CANCEL</button>
                            <button className="primary-btn small" onClick={handleSave}>APPLY CHANGES</button>
                        </div>
                    </div>
                </GlassCard>
            </div>
        </div>
    );
};
