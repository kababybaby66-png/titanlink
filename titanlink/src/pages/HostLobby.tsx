import React, { useState, useEffect } from 'react';
import type { SessionState } from '../App';
import type { DisplayInfo, SystemStats } from '../../shared/types/ipc';
import { GlassCard } from '../components/ui/GlassCard';
import './HostLobby.css';

interface HostLobbyProps {
    sessionState: SessionState;
    onStartHosting: (displayId: string) => Promise<string>;
    onBack: () => void;
    error: string | null;
}

export function HostLobby({ sessionState, onStartHosting, onBack, error }: HostLobbyProps) {
    const [displays, setDisplays] = useState<DisplayInfo[]>([]);
    const [selectedDisplay, setSelectedDisplay] = useState<string>('');
    const [isStarting, setIsStarting] = useState(false);
    const [logs, setLogs] = useState<string[]>(['[SYSTEM] Daemon started...', '[SYSTEM] Verifying integrity... OK']);
    const [localError, setLocalError] = useState<string | null>(null);
    const [stats, setStats] = useState<SystemStats>({ cpuUsage: 0, memUsage: 0, totalMem: 0, freeMem: 0 });

    const isHosting = sessionState.connectionState !== 'disconnected';

    const addLog = (msg: string) => {
        const time = new Date().toLocaleTimeString('en-US', { hour12: false });
        setLogs(prev => [...prev.slice(-6), `[${time}] ${msg}`]);
    };

    useEffect(() => {
        const loadDisplays = async () => {
            try {
                if (window.electronAPI?.system) {
                    const availableDisplays = await window.electronAPI.system.getDisplays();
                    setDisplays(availableDisplays);
                    addLog(`Discovered ${availableDisplays.length} display outputs`);

                    const primary = availableDisplays.find(d => d.primary) || availableDisplays[0];
                    if (primary) {
                        setSelectedDisplay(primary.id);
                    }
                }
            } catch (err) {
                console.error('Error loading displays:', err);
                setLocalError('Failed to load displays');
                addLog('[ERROR] Display fetch failed');
            }
        };
        loadDisplays();
    }, []);

    useEffect(() => {
        const interval = setInterval(async () => {
            if (window.electronAPI?.system?.getStats) {
                try {
                    const s = await window.electronAPI.system.getStats();
                    setStats(s);
                } catch (e) {
                    console.error('Stats error:', e);
                }
            }
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (sessionState.connectionState === 'waiting-for-peer') {
            addLog('Status: Broadcasting Beacon');
        } else if (sessionState.connectionState === 'connecting') {
            addLog('Status: Peer Negotiation');
        } else if (sessionState.connectionState === 'streaming') {
            addLog('Status: Uplink Established');
        }
    }, [sessionState.connectionState]);

    const handleStartHosting = async () => {
        if (!selectedDisplay) return;

        setIsStarting(true);
        setLocalError(null);
        addLog('Init sequence started...');

        try {
            await onStartHosting(selectedDisplay);
            addLog('Session Created successfully');
        } catch (err) {
            setLocalError(err instanceof Error ? err.message : 'Failed to start hosting');
            addLog('[ERROR] Init failed');
        } finally {
            setIsStarting(false);
        }
    };

    const handleCopyCode = async () => {
        if (!sessionState.sessionCode) return;
        try {
            await navigator.clipboard.writeText(sessionState.sessionCode);
            addLog('Clipboard: Code copied');
        } catch (err) {
            console.error(err);
        }
    };

    return (
        <div className="host-lobby-grid">
            {/* LEFT PANEL: Network Telemetry */}
            <aside className="lobby-panel left-panel">
                <GlassCard className="telemetry-card">
                    <div className="card-header">
                        <span className="material-symbols-outlined icon">speed</span>
                        <span className="title">LATENCY</span>
                        <span className="sub">RT_PING</span>
                    </div>
                    <div className="card-value large">
                        4<span className="unit">ms</span>
                    </div>
                    {/* Fake Graph */}
                    <div className="mini-graph">
                        {[...Array(15)].map((_, i) => (
                            <div key={i} className="bar" style={{ height: `${20 + Math.random() * 80}%` }}></div>
                        ))}
                    </div>
                </GlassCard>

                <div className="region-protocol-group">
                    <GlassCard className="info-card region-card">
                        <div className="card-bg-map"></div>
                        <div className="relative z-10">
                            <div className="card-header">
                                <span className="material-symbols-outlined icon">public</span>
                                <span className="title">REGION</span>
                            </div>
                            <div className="card-value">US-EAST-VA</div>
                            <div className="card-sub">NODE_ID: #8821</div>
                        </div>
                    </GlassCard>

                    <GlassCard className="info-card protocol-card">
                        <div className="card-header">
                            <span className="material-symbols-outlined icon">hub</span>
                            <span className="title">PROTOCOL</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <div className="card-value">UDP/P2P</div>
                            <span className="badge-secure">SECURE</span>
                        </div>
                    </GlassCard>
                </div>
            </aside>

            {/* CENTER PANEL: Session HUD or Selection */}
            <section className="lobby-center">
                <div className="center-decoration"></div>

                {!isHosting ? (
                    <div className="setup-mode">
                        <h2 className="setup-title">CONFIGURE UPLINK</h2>

                        <div className="display-selector">
                            <label className="section-label">SELECT SOURCE FEED</label>
                            <div className="display-grid">
                                {displays.map((display) => (
                                    <div
                                        key={display.id}
                                        className={`display-option ${selectedDisplay === display.id ? 'active' : ''}`}
                                        onClick={() => setSelectedDisplay(display.id)}
                                    >
                                        <span className="material-symbols-outlined icon">monitor</span>
                                        <div className="display-details">
                                            <span className="name">{display.name}</span>
                                            <span className="res">{display.width}x{display.height}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="setup-actions">
                            <button className="secondary-btn" onClick={onBack}>ABORT</button>
                            <button
                                className="primary-btn pulse-glow"
                                onClick={handleStartHosting}
                                disabled={isStarting || !selectedDisplay}
                            >
                                {isStarting ? 'INITIALIZING...' : 'ACTIVATE BEACON'}
                            </button>
                        </div>
                        {error || localError ? <div className="error-msg">{error || localError}</div> : null}
                    </div>
                ) : (
                    <div className="active-mode">
                        <div className="status-indicator">
                            <span className="material-symbols-outlined icon animate-spin">sync</span>
                            <span className="text">SECURE LINK ESTABLISHED</span>
                        </div>

                        <div className="session-code-display" onClick={handleCopyCode} title="Click to copy">
                            <h1 className="code-text glow-text">{sessionState.sessionCode}</h1>
                            <div className="code-status">
                                <span className="dot animate-pulse"></span>
                                <span>WAITING FOR CONNECTION...</span>
                            </div>
                        </div>

                        <div className="peer-slots">
                            {[...Array(4)].map((_, i) => (
                                <div key={i} className="peer-slot empty">
                                    <span className="material-symbols-outlined">person</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </section>

            {/* RIGHT PANEL: System Telemetry */}
            <aside className="lobby-panel right-panel">
                <div className="resources-grid">
                    <GlassCard className="resource-card">
                        <div className="card-header">
                            <span className="material-symbols-outlined icon">memory</span>
                            <span className="title">CPU</span>
                        </div>
                        <div className="card-value">{stats.cpuUsage}<span className="unit">%</span></div>
                        <div className="progress-bar"><div className="fill" style={{ width: `${stats.cpuUsage}%` }}></div></div>
                    </GlassCard>

                    <GlassCard className="resource-card">
                        <div className="card-header">
                            <span className="material-symbols-outlined icon">storage</span>
                            <span className="title">MEM</span>
                        </div>
                        <div className="card-value">{stats.memUsage}<span className="unit">%</span></div>
                        <div className="progress-bar purple"><div className="fill" style={{ width: `${stats.memUsage}%` }}></div></div>
                        <div className="text-xs text-center mt-1 text-white/50 font-mono">
                            {(stats.totalMem - stats.freeMem).toFixed(1)} / {stats.totalMem} GB
                        </div>
                    </GlassCard>
                </div>

                <div className="system-log-panel">
                    <div className="log-header">
                        <span>SYSTEM LOG</span>
                        <span className="material-symbols-outlined icon">terminal</span>
                    </div>
                    <div className="log-content custom-scrollbar">
                        {logs.map((log, i) => (
                            <div key={i} className="log-entry">
                                <span className="entry-text">{log}</span>
                            </div>
                        ))}
                        <div className="log-entry animate-pulse">_</div>
                    </div>
                </div>

                {isHosting && (
                    <button className="stop-hosting-btn" onClick={onBack}>
                        <span className="material-symbols-outlined">power_settings_new</span>
                        STOP HOSTING
                    </button>
                )}
            </aside>
        </div>
    );
}
