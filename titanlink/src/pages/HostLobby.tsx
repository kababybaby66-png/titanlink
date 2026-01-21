import React, { useState, useEffect } from 'react';
import type { SessionState } from '../App';
import type { DisplayInfo } from '../../shared/types/ipc';
import { CyberButton } from '../components/CyberButton';
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
    const [copied, setCopied] = useState(false);
    const [logs, setLogs] = useState<string[]>(['> SYSTEM_INIT', '> LOADING_DISPLAY_DRIVERS...']);
    const [localError, setLocalError] = useState<string | null>(null);

    const isHosting = sessionState.connectionState !== 'disconnected';

    // Add log helper
    const addLog = (msg: string) => {
        setLogs(prev => [...prev.slice(-4), `> ${msg}`.toUpperCase()]);
    };

    // Load available displays
    useEffect(() => {
        const loadDisplays = async () => {
            try {
                if (window.electronAPI?.system) {
                    const availableDisplays = await window.electronAPI.system.getDisplays();
                    setDisplays(availableDisplays);
                    addLog(`DISPLAYS_DETECTED: ${availableDisplays.length}`);

                    const primary = availableDisplays.find(d => d.primary) || availableDisplays[0];
                    if (primary) {
                        setSelectedDisplay(primary.id);
                    }
                }
            } catch (err) {
                console.error('Error loading displays:', err);
                setLocalError('Failed to load displays');
                addLog('ERROR: DISPLAY_FETCH_FAILED');
            }
        };

        loadDisplays();
    }, []);

    // Watch session state for logs
    useEffect(() => {
        if (sessionState.connectionState === 'waiting-for-peer') {
            addLog('STATUS: BROADCASTING_BEACON');
        } else if (sessionState.connectionState === 'connecting') {
            addLog('STATUS: PEER_NEGOTIATION');
        } else if (sessionState.connectionState === 'streaming') {
            addLog('STATUS: UPLINK_ESTABLISHED');
        }
    }, [sessionState.connectionState]);

    const handleStartHosting = async () => {
        if (!selectedDisplay) return;

        setIsStarting(true);
        setLocalError(null);
        addLog('INIT_SEQUENCE_STARTED...');

        try {
            await onStartHosting(selectedDisplay);
            addLog('SESSION_CREATED');
        } catch (err) {
            setLocalError(err instanceof Error ? err.message : 'Failed to start hosting');
            addLog('ERROR: INIT_FAILED');
        } finally {
            setIsStarting(false);
        }
    };

    const handleCopyCode = async () => {
        if (!sessionState.sessionCode) return;
        try {
            await navigator.clipboard.writeText(sessionState.sessionCode);
            setCopied(true);
            addLog('CLIPBOARD: CODE_COPIED');
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    return (
        <div className="host-lobby-page">
            <div className="tech-container panel">
                <div className="panel-header">
                    <h2 className="text-cyan">ORBITAL BROADCAST</h2>
                    <div className="header-decoration"></div>
                </div>

                {error || localError ? (
                    <div className="error-box text-danger">
                        <span className="blink">⚠</span> {error || localError}
                    </div>
                ) : null}

                <div className="panel-content">
                    {!isHosting ? (
                        <>
                            <div className="selection-grid">
                                <label className="tech-label">SELECT SOURCE FEED:</label>
                                {displays.map((display) => (
                                    <div
                                        key={display.id}
                                        className={`display-item ${selectedDisplay === display.id ? 'active' : ''}`}
                                        onClick={() => setSelectedDisplay(display.id)}
                                    >
                                        <div className="display-icon">□</div>
                                        <div className="display-info">
                                            <span className="d-name">{display.name}</span>
                                            <span className="d-res">{display.width}x{display.height}</span>
                                        </div>
                                    </div>
                                ))}
                            </div>

                            <div className="actions-row">
                                <CyberButton variant="secondary" onClick={onBack}>ABORT</CyberButton>
                                <CyberButton
                                    variant="primary"
                                    onClick={handleStartHosting}
                                    disabled={!selectedDisplay || isStarting}
                                    glitch={isStarting}
                                >
                                    {isStarting ? 'INITIALIZING...' : 'ACTIVATE BEACON'}
                                </CyberButton>
                            </div>
                        </>
                    ) : (
                        <div className="broadcast-active">
                            <div className="code-display-box">
                                <label className="tech-label">ACCESS KEY</label>
                                <div className="session-code-glitch" onClick={handleCopyCode}>
                                    {sessionState.sessionCode}
                                </div>
                                <div className="copy-hint">{copied ? 'COPIED TO CLIPBOARD' : 'CLICK TO COPY'}</div>
                            </div>

                            <div className="terminal-log">
                                {logs.map((log, i) => (
                                    <div key={i} className="log-line">{log}</div>
                                ))}
                                <div className="log-line blink">_</div>
                            </div>

                            <CyberButton variant="danger" onClick={onBack} className="w-full">
                                TERMINATE UPLINK
                            </CyberButton>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
