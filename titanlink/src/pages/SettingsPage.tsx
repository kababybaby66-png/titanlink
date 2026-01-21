import React from 'react';
import { StreamSettings, DEFAULT_SETTINGS } from '../../shared/types/ipc';
import { CyberButton } from '../components/CyberButton';
import './SettingsPage.css';

interface SettingsPageProps {
    settings: StreamSettings;
    onSave: (settings: StreamSettings) => void;
    onBack: () => void;
}

export function SettingsPage({ settings, onSave, onBack }: SettingsPageProps) {
    const [localSettings, setLocalSettings] = React.useState<StreamSettings>(settings);

    const handleChange = (key: keyof StreamSettings, value: StreamSettings[keyof StreamSettings]) => {
        setLocalSettings(prev => ({ ...prev, [key]: value }));
    };

    const handleSave = () => {
        onSave(localSettings);
        onBack();
    };

    const applyPreset = (preset: 'low-latency' | 'balanced' | 'quality') => {
        switch (preset) {
            case 'low-latency':
                setLocalSettings({ ...localSettings, resolution: '720p', fps: 60, bitrate: 5, codec: 'h264' });
                break;
            case 'balanced':
                setLocalSettings({ ...localSettings, resolution: '1080p', fps: 60, bitrate: 15, codec: 'h264' });
                break;
            case 'quality':
                setLocalSettings({ ...localSettings, resolution: '1440p', fps: 60, bitrate: 30, codec: 'h264' });
                break;
        }
    };

    return (
        <div className="settings-page">
            <div className="settings-panel panel">
                <div className="panel-header">
                    <h2 className="text-cyan">SYSTEM CONFIGURATION</h2>
                    <div className="header-decoration"></div>
                </div>

                <div className="settings-layout">
                    {/* PRESETS */}
                    <div className="presets-section">
                        <label className="tech-label">QUICK_PRESETS</label>
                        <div className="presets-grid">
                            <button className="preset-card" onClick={() => applyPreset('low-latency')}>
                                <div className="p-icon">🚀</div>
                                <div className="p-info">
                                    <span className="p-name">VELOCITY</span>
                                    <span className="p-detail">Low Latency / 720p</span>
                                </div>
                            </button>
                            <button className="preset-card" onClick={() => applyPreset('balanced')}>
                                <div className="p-icon">⚖️</div>
                                <div className="p-info">
                                    <span className="p-name">VANGUARD</span>
                                    <span className="p-detail">Balanced / 1080p</span>
                                </div>
                            </button>
                            <button className="preset-card" onClick={() => applyPreset('quality')}>
                                <div className="p-icon">💎</div>
                                <div className="p-info">
                                    <span className="p-name">FIDELITY</span>
                                    <span className="p-detail">High Quality / 1440p</span>
                                </div>
                            </button>
                        </div>
                    </div>

                    {/* MANUAL CONFIG */}
                    <div className="config-grid">
                        <div className="config-group">
                            <label className="tech-label">RESOLUTION_SCALE</label>
                            <select
                                className="cyber-select"
                                value={localSettings.resolution}
                                onChange={(e) => handleChange('resolution', e.target.value as StreamSettings['resolution'])}
                            >
                                <option value="720p">720P // HD</option>
                                <option value="1080p">1080P // FHD</option>
                                <option value="1440p">1440P // QHD</option>
                                <option value="4k">2160P // 4K</option>
                            </select>
                        </div>

                        <div className="config-group">
                            <label className="tech-label">REFRESH_CYCLE (FPS)</label>
                            <select
                                className="cyber-select"
                                value={localSettings.fps}
                                onChange={(e) => handleChange('fps', Number(e.target.value))}
                            >
                                <option value={30}>30 HZ</option>
                                <option value={60}>60 HZ</option>
                                <option value={120}>120 HZ</option>
                                <option value={144}>144 HZ</option>
                            </select>
                        </div>

                        <div className="config-group wide">
                            <label className="tech-label">BANDWIDTH_ALLOCATION: <span className="text-cyan">{localSettings.bitrate} MBPS</span></label>
                            <input
                                type="range"
                                min="5"
                                max="50"
                                step="5"
                                value={localSettings.bitrate}
                                onChange={(e) => handleChange('bitrate', Number(e.target.value))}
                                className="cyber-range"
                            />
                        </div>

                        <div className="config-group">
                            <label className="tech-label">ENCODING_PROTOCOL</label>
                            <select
                                className="cyber-select"
                                value={localSettings.codec}
                                onChange={(e) => handleChange('codec', e.target.value as StreamSettings['codec'])}
                            >
                                <option value="h264">H.264 // LEGACY</option>
                                <option value="vp8">VP8 // STABLE</option>
                                <option value="vp9">VP9 // MODERN</option>
                            </select>
                        </div>
                    </div>
                </div>

                <div className="actions-row settings-actions">
                    <CyberButton variant="ghost" onClick={() => setLocalSettings(DEFAULT_SETTINGS)}>
                        RESET_DEFAULTS
                    </CyberButton>
                    <div className="action-group-right">
                        <CyberButton variant="secondary" onClick={onBack}>CANCEL</CyberButton>
                        <CyberButton variant="primary" onClick={handleSave}>CONFIRM_CHANGES</CyberButton>
                    </div>
                </div>
            </div>
        </div>
    );
}
