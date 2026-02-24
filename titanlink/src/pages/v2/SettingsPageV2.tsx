import React, { useState } from 'react';
import { ButtonV2 } from '../../components/ui/v2/ButtonV2';
import { CardV2 } from '../../components/ui/v2/CardV2';
import type { StreamSettings } from '../../../shared/types/ipc';
import '../SettingsPage.css';

interface SettingsPageV2Props {
    settings: StreamSettings;
    onSave: (settings: StreamSettings) => void;
    onBack: () => void;
}

export const SettingsPageV2: React.FC<SettingsPageV2Props> = ({ settings, onSave, onBack }) => {
    const [localSettings, setLocalSettings] = useState<StreamSettings>(settings);

    const handleSave = () => {
        onSave(localSettings);
        if (window.electronAPI?.app?.setLaunchOnStartup) {
            window.electronAPI.app.setLaunchOnStartup(localSettings.launchOnStartup);
        }
        onBack();
    };

    const updateSetting = <K extends keyof StreamSettings>(key: K, value: StreamSettings[K]) => {
        setLocalSettings(prev => ({ ...prev, [key]: value }));
    };

    return (
        <div className="settings-page">
            <div className="settings-container">
                <CardV2 className="settings-panel">
                    <div className="settings-header">
                        <div className="flex items-center gap-3">
                            <span className="material-symbols-outlined text-primary text-3xl">tune</span>
                            <h2>SYSTEM CONFIGURATION</h2>
                        </div>
                        <ButtonV2 variant="ghost" size="sm" onClick={onBack}>
                            <span className="material-symbols-outlined">close</span>
                        </ButtonV2>
                    </div>

                    <div className="settings-content custom-scrollbar">
                        {/* UI VERSION */}
                        <div className="settings-section">
                            <h3 className="section-title">INTERFACE</h3>
                            <div className="setting-item">
                                <div className="setting-info">
                                    <span className="label">UI Version</span>
                                    <span className="desc">Switch between V1 (classic) and V2 (new) interface</span>
                                </div>
                                <div className="flex gap-2">
                                    <ButtonV2
                                        variant={localSettings.uiVersion === 'v1' ? 'primary' : 'ghost'}
                                        size="sm"
                                        onClick={() => updateSetting('uiVersion', 'v1')}
                                    >
                                        V1
                                    </ButtonV2>
                                    <ButtonV2
                                        variant={localSettings.uiVersion === 'v2' ? 'primary' : 'ghost'}
                                        size="sm"
                                        onClick={() => updateSetting('uiVersion', 'v2')}
                                    >
                                        V2
                                    </ButtonV2>
                                </div>
                            </div>
                        </div>

                        {/* GENERAL SETTINGS */}
                        <div className="settings-section">
                            <h3 className="section-title">GENERAL</h3>
                            <div className="setting-item">
                                <div className="setting-info">
                                    <span className="label">Launch on Startup</span>
                                    <span className="desc">Automatically initialize daemon on system boot</span>
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
                                    <span className="label">Hardware Acceleration</span>
                                    <span className="desc">Use GPU for encoding/decoding</span>
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
                                    <label>Preferred Port</label>
                                    <input
                                        type="number"
                                        className="cyber-input-sm"
                                        value={localSettings.preferredPort}
                                        onChange={(e) => updateSetting('preferredPort', parseInt(e.target.value) || 8000)}
                                    />
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
                                    <label>Gamepad Emulation</label>
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
                            <h3 className="section-title">AUDIO</h3>
                            <div className="input-row">
                                <div className="input-field">
                                    <label>Sample Rate</label>
                                    <select
                                        className="cyber-select"
                                        value={localSettings.audioSampleRate}
                                        onChange={(e) => updateSetting('audioSampleRate', parseInt(e.target.value) as any)}
                                    >
                                        <option value="48000">48 kHz (High Quality)</option>
                                        <option value="44100">44.1 kHz (Standard)</option>
                                    </select>
                                </div>
                                <div className="input-field">
                                    <label>Audio Bitrate</label>
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
                                        <ButtonV2
                                            variant={localSettings.bitrateMode === 'cbr' ? 'primary' : 'ghost'}
                                            size="sm"
                                            onClick={() => updateSetting('bitrateMode', 'cbr')}
                                        >
                                            CBR (Stable)
                                        </ButtonV2>
                                        <ButtonV2
                                            variant={localSettings.bitrateMode === 'vbr' ? 'primary' : 'ghost'}
                                            size="sm"
                                            onClick={() => updateSetting('bitrateMode', 'vbr')}
                                        >
                                            VBR (Quality)
                                        </ButtonV2>
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
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="settings-footer">
                        <span className="version">TitanLink v2.0.0 build 2300</span>
                        <div className="footer-actions">
                            <ButtonV2 variant="secondary" size="sm" onClick={onBack}>CANCEL</ButtonV2>
                            <ButtonV2 variant="primary" size="sm" onClick={handleSave}>APPLY CHANGES</ButtonV2>
                        </div>
                    </div>
                </CardV2>
            </div>
        </div>
    );
};
