
import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { SessionState } from '../App';
import type { DisplayInfo, SystemStats, GamepadInputState } from '../../shared/types/ipc';
import { GlassCard } from '../components/ui/GlassCard';
import { StatusVisualizer } from '../components/StatusVisualizer';
import { ControllerOverlay } from '../components/ControllerOverlay';
import { AudioSetupModal } from '../components/AudioSetupModal';
import { webrtcService } from '../services/WebRTCService';
import './HostLobby.css';

interface HostLobbyProps {
    sessionState: SessionState;
    onStartHosting: (displayId: string) => Promise<string>;
    onBack: () => void;
    error: string | null;
}

// Resizable Widget Component - handles resize from entire border
interface ResizableWidgetProps {
    id: string;
    panel: 'left' | 'right';
    children: React.ReactNode;
    onDragStart: (e: React.DragEvent, id: string, panel: 'left' | 'right') => void;
    onDrop: (e: React.DragEvent, id: string, panel: 'left' | 'right') => void;
}

function ResizableWidget({ id, panel, children, onDragStart, onDrop }: ResizableWidgetProps) {
    const widgetRef = useRef<HTMLDivElement>(null);
    const [isResizing, setIsResizing] = useState(false);
    const [height, setHeight] = useState<number | undefined>(undefined);
    const startY = useRef(0);
    const startHeight = useRef(0);

    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        // Check if clicking near edges (within 12px of any edge)
        const rect = widgetRef.current?.getBoundingClientRect();
        if (!rect) return;

        const distToTop = e.clientY - rect.top;
        const distToBottom = rect.bottom - e.clientY;
        const edgeThreshold = 12;

        // Only trigger resize if near top or bottom edge
        if (distToTop <= edgeThreshold || distToBottom <= edgeThreshold) {
            e.preventDefault();
            e.stopPropagation();
            setIsResizing(true);
            startY.current = e.clientY;
            startHeight.current = rect.height;
            widgetRef.current?.classList.add('resizing');
        }
    }, []);

    const handleMouseMove = useCallback((e: MouseEvent) => {
        if (!isResizing) return;

        const deltaY = e.clientY - startY.current;
        const newHeight = Math.max(80, startHeight.current + deltaY);
        setHeight(newHeight);
    }, [isResizing]);

    const handleMouseUp = useCallback(() => {
        if (isResizing) {
            setIsResizing(false);
            widgetRef.current?.classList.remove('resizing');
        }
    }, [isResizing]);

    useEffect(() => {
        if (isResizing) {
            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('mouseup', handleMouseUp);
            return () => {
                window.removeEventListener('mousemove', handleMouseMove);
                window.removeEventListener('mouseup', handleMouseUp);
            };
        }
    }, [isResizing, handleMouseMove, handleMouseUp]);

    return (
        <div
            ref={widgetRef}
            className={`draggable-widget ${isResizing ? 'resizing' : ''}`}
            style={{ height: height ? `${height}px` : undefined }}
            draggable={!isResizing}
            onDragStart={(e) => !isResizing && onDragStart(e, id, panel)}
            onDrop={(e) => onDrop(e, id, panel)}
            onMouseDown={handleMouseDown}
        >
            {children}
        </div>
    );
}

export function HostLobby({ sessionState, onStartHosting, onBack, error }: HostLobbyProps) {
    const [displays, setDisplays] = useState<DisplayInfo[]>([]);
    const [selectedDisplay, setSelectedDisplay] = useState<string>('');
    const [isStarting, setIsStarting] = useState(false);
    const [logs, setLogs] = useState<string[]>(['[SYSTEM] Daemon started...', '[SYSTEM] Verifying integrity... OK']);
    const [localError, setLocalError] = useState<string | null>(null);
    const [stats, setStats] = useState<SystemStats>({ cpuUsage: 0, memUsage: 0, totalMem: 0, freeMem: 0 });

    // Controller detection state (for when client connects)
    const [controllerConnected, setControllerConnected] = useState(false);
    const [currentInput, setCurrentInput] = useState<GamepadInputState | null>(null);
    const [showControllerOverlay, setShowControllerOverlay] = useState(true);

    // Audio setup modal state
    const [showAudioSetupModal, setShowAudioSetupModal] = useState(false);

    // Connection quality metrics
    const [connectionQuality, setConnectionQuality] = useState({
        latency: 0,
        packetLoss: 0,
        jitter: 0,
        networkQuality: 'excellent' as string,
    });

    const isHosting = sessionState.connectionState !== 'disconnected';
    const isStreaming = sessionState.connectionState === 'streaming';

    // -- DRAG & DROP STATE --
    // Note: 'controller', 'client', 'quality' will only render when streaming is active
    const [panels, setPanels] = useState<{ left: string[], right: string[] }>({
        left: ['latency', 'region', 'protocol', 'audio', 'client', 'quality'],
        right: ['reactor', 'resources', 'controller', 'logs', 'stopbtn']
    });

    const [draggedItem, setDraggedItem] = useState<string | null>(null);
    const [dragSourcePanel, setDragSourcePanel] = useState<'left' | 'right' | null>(null);

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
                    if (availableDisplays.length > 0) setSelectedDisplay(availableDisplays[0].id);
                }
            } catch (err) {
                console.error('Error loading displays:', err);
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
                } catch (e) { }
            }
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (sessionState.connectionState === 'waiting-for-peer') addLog('Status: Broadcasting Beacon');
        else if (sessionState.connectionState === 'connecting') addLog('Status: Peer Negotiation');
        else if (sessionState.connectionState === 'streaming') addLog('Status: Uplink Established');
    }, [sessionState.connectionState]);

    // Listen for controller input from connected client
    useEffect(() => {
        if (!isStreaming) return;

        const handleInputReceived = (e: CustomEvent<GamepadInputState>) => {
            setCurrentInput(e.detail);
            setControllerConnected(true);
        };

        window.addEventListener('titanlink:input' as any, handleInputReceived);

        return () => {
            window.removeEventListener('titanlink:input' as any, handleInputReceived);
        };
    }, [isStreaming]);

    // Poll connection quality metrics when streaming
    useEffect(() => {
        if (!isStreaming) return;

        const interval = setInterval(() => {
            const quality = webrtcService.getConnectionQuality();
            setConnectionQuality({
                latency: quality.latency,
                packetLoss: quality.packetLoss,
                jitter: quality.jitter,
                networkQuality: quality.networkQuality,
            });
        }, 1000);

        return () => clearInterval(interval);
    }, [isStreaming]);

    const handleStartHosting = async () => {
        if (!selectedDisplay) return;
        setIsStarting(true);
        setLocalError(null);
        addLog('Init sequence started...');
        try {
            await onStartHosting(selectedDisplay);
            addLog('Session Created successfully');

            // Check if audio was captured - if not, show the audio setup modal
            const hasAudio = webrtcService.getConnectionQuality().hasAudio;
            if (!hasAudio) {
                addLog('[WARN] Audio capture failed - showing setup options');
                setTimeout(() => setShowAudioSetupModal(true), 500);
            }
        } catch (err) {
            setLocalError(err instanceof Error ? err.message : 'Failed');
            addLog('[ERROR] Init failed');
        } finally {
            setIsStarting(false);
        }
    };

    const handleCopyCode = async () => {
        if (!sessionState.sessionCode) return;
        navigator.clipboard.writeText(sessionState.sessionCode);
        addLog('Clipboard: Code copied');
    };

    // -- DRAG HANDLERS --
    const onDragStart = (e: React.DragEvent, id: string, panel: 'left' | 'right') => {
        setDraggedItem(id);
        setDragSourcePanel(panel);
        e.dataTransfer.effectAllowed = "move";
        // e.target.classList.add('dragging'); // Handled by CSS logic potentially?
    };

    const onDragOver = (e: React.DragEvent) => {
        e.preventDefault(); // Necessary to allow dropping
    };

    const onDrop = (e: React.DragEvent, targetId: string, targetPanel: 'left' | 'right') => {
        e.preventDefault();
        if (!draggedItem || !dragSourcePanel) return;

        if (draggedItem === targetId) return;

        // Clone state
        const newPanels = {
            left: [...panels.left],
            right: [...panels.right]
        };

        // Remove from source
        const sourceIndex = newPanels[dragSourcePanel].indexOf(draggedItem);
        if (sourceIndex === -1) return;
        newPanels[dragSourcePanel].splice(sourceIndex, 1);

        // Add to target
        // If targetId is special 'container-drop', append to end? 
        // Logic: if dropped ON an item, insert before/after. 
        // For simplicity: Insert BEFORE the target item.
        const targetIndex = newPanels[targetPanel].indexOf(targetId);
        if (targetIndex !== -1) {
            newPanels[targetPanel].splice(targetIndex, 0, draggedItem);
        } else {
            // Should not happen if dropping on item, but fallback to push
            newPanels[targetPanel].push(draggedItem);
        }

        setPanels(newPanels);
        setDraggedItem(null);
        setDragSourcePanel(null);
    };

    const onDropContainer = (e: React.DragEvent, panel: 'left' | 'right') => {
        e.preventDefault();
        // Only handle drop if dropping on empty space or container itself (not bubbled from item)
        if (e.target !== e.currentTarget) return;
        if (!draggedItem || !dragSourcePanel) return;

        // Move to end of list
        const newPanels = { left: [...panels.left], right: [...panels.right] };
        const sourceIndex = newPanels[dragSourcePanel].indexOf(draggedItem);
        if (sourceIndex === -1) return;
        newPanels[dragSourcePanel].splice(sourceIndex, 1);
        newPanels[panel].push(draggedItem);

        setPanels(newPanels);
        setDraggedItem(null);
        setDragSourcePanel(null);
    };

    // -- WIDGET RENDERER --
    const renderWidget = (id: string) => {
        switch (id) {
            case 'latency':
                return (
                    <GlassCard className="telemetry-card">
                        <div className="card-header">
                            <span className="material-symbols-outlined icon">speed</span>
                            <span className="title">LATENCY</span>
                        </div>
                        <div className="card-value large">{connectionQuality.latency}<span className="unit">ms</span></div>
                    </GlassCard>
                );
            case 'region':
                return (
                    <GlassCard className="info-card">
                        <div className="card-header">
                            <span className="material-symbols-outlined icon">public</span>
                            <span className="title">REGION</span>
                        </div>
                        <div className="card-value">US-EAST-VA</div>
                        <div className="card-sub">NODE: #8821</div>
                    </GlassCard>
                );
            case 'protocol':
                return (
                    <GlassCard className="info-card">
                        <div className="card-header">
                            <span className="material-symbols-outlined icon">hub</span>
                            <span className="title">PROTOCOL</span>
                        </div>
                        <div className="card-value">UDP/P2P</div>
                        <span className="badge-secure">SECURE</span>
                    </GlassCard>
                );
            case 'audio':
                // Audio status widget - only show when hosting
                if (!isHosting) return null;
                const hasAudio = webrtcService.getConnectionQuality().hasAudio;
                return (
                    <GlassCard className={`audio-widget ${hasAudio ? 'active' : 'inactive'}`}>
                        <div className="card-header">
                            <span className="material-symbols-outlined icon">
                                {hasAudio ? 'volume_up' : 'volume_off'}
                            </span>
                            <span className="title">AUDIO</span>
                            <span className={`status-badge ${hasAudio ? 'connected' : 'disconnected'}`}>
                                {hasAudio ? 'ACTIVE' : 'DISABLED'}
                            </span>
                        </div>
                        {!hasAudio && (
                            <button
                                className="audio-fix-btn"
                                onClick={() => setShowAudioSetupModal(true)}
                            >
                                <span className="material-symbols-outlined">settings</span>
                                Fix Audio
                            </button>
                        )}
                    </GlassCard>
                );
            case 'reactor':
                return (
                    <div className="status-viz-container" style={{ height: '100%', width: '100%', minHeight: '120px' }}>
                        <StatusVisualizer cpuUsage={stats.cpuUsage} memUsage={stats.memUsage} />
                    </div>
                );
            case 'resources':
                return (
                    <div className="resources-container">
                        <GlassCard className="resource-card" style={{ flex: 1 }}>
                            <div className="card-header"><span className="title">CPU</span></div>
                            <div className="card-value">{stats.cpuUsage}<span className="unit">%</span></div>
                            <div className="progress-bar"><div className="fill" style={{ width: `${stats.cpuUsage}%` }}></div></div>
                        </GlassCard>
                        <GlassCard className="resource-card" style={{ flex: 1 }}>
                            <div className="card-header"><span className="title">MEM</span></div>
                            <div className="card-value">{stats.memUsage}<span className="unit">%</span></div>
                            <div className="progress-bar purple"><div className="fill" style={{ width: `${stats.memUsage}%` }}></div></div>
                        </GlassCard>
                    </div>
                );
            case 'logs':
                return (
                    <div className="system-log-panel" style={{ height: '100%' }}>
                        <div className="log-header">
                            <span>SYSTEM LOG</span>
                            <span className="material-symbols-outlined icon">terminal</span>
                        </div>
                        <div className="log-content custom-scrollbar">
                            {logs.map((log, i) => (
                                <div key={i} className="log-entry"><span className="entry-text">{log}</span></div>
                            ))}
                        </div>
                    </div>
                );
            case 'stopbtn':
                if (!isHosting) return null; // Only show when hosting
                return (
                    <button className="stop-hosting-btn" onClick={onBack}>
                        <span className="material-symbols-outlined">power_settings_new</span>
                        STOP HOSTING
                    </button>
                );
            case 'controller':
                // Controller input visualization - only show when streaming
                if (!isStreaming) return null;
                return (
                    <GlassCard className="controller-widget">
                        <div className="card-header">
                            <span className="material-symbols-outlined icon">gamepad</span>
                            <span className="title">CONTROLLER</span>
                            <span className={`status-badge ${controllerConnected ? 'connected' : 'disconnected'}`}>
                                {controllerConnected ? 'ACTIVE' : 'WAITING'}
                            </span>
                        </div>
                        <div className="controller-preview">
                            <ControllerOverlay input={currentInput} connected={controllerConnected} />
                        </div>
                    </GlassCard>
                );
            case 'client':
                // Connected client info - only show when streaming
                if (!isStreaming) return null;
                return (
                    <GlassCard className="client-widget">
                        <div className="card-header">
                            <span className="material-symbols-outlined icon">person</span>
                            <span className="title">CLIENT</span>
                        </div>
                        <div className="client-info">
                            <div className="client-name">{sessionState.peerInfo?.username || 'Remote User'}</div>
                            <div className="client-stats">
                                <div className="stat">
                                    <span className="label">Quality</span>
                                    <span className={`value quality-${connectionQuality.networkQuality}`}>
                                        {connectionQuality.networkQuality.toUpperCase()}
                                    </span>
                                </div>
                                <div className="stat">
                                    <span className="label">Loss</span>
                                    <span className="value">{connectionQuality.packetLoss.toFixed(1)}%</span>
                                </div>
                                <div className="stat">
                                    <span className="label">Jitter</span>
                                    <span className="value">{connectionQuality.jitter.toFixed(0)}ms</span>
                                </div>
                            </div>
                        </div>
                    </GlassCard>
                );
            case 'quality':
                // Network quality indicator - only show when streaming
                if (!isStreaming) return null;
                return (
                    <GlassCard className="quality-widget">
                        <div className="card-header">
                            <span className="material-symbols-outlined icon">signal_cellular_alt</span>
                            <span className="title">NETWORK</span>
                        </div>
                        <div className={`quality-indicator ${connectionQuality.networkQuality}`}>
                            <div className="quality-bars">
                                <div className={`bar ${['excellent', 'good', 'fair', 'poor', 'critical'].indexOf(connectionQuality.networkQuality) <= 0 ? 'active' : ''}`}></div>
                                <div className={`bar ${['excellent', 'good', 'fair', 'poor'].indexOf(connectionQuality.networkQuality) <= 1 ? 'active' : ''}`}></div>
                                <div className={`bar ${['excellent', 'good', 'fair'].indexOf(connectionQuality.networkQuality) <= 2 ? 'active' : ''}`}></div>
                                <div className={`bar ${['excellent', 'good'].indexOf(connectionQuality.networkQuality) <= 1 ? 'active' : ''}`}></div>
                                <div className={`bar ${connectionQuality.networkQuality === 'excellent' ? 'active' : ''}`}></div>
                            </div>
                            <div className="quality-label">{connectionQuality.networkQuality.toUpperCase()}</div>
                        </div>
                    </GlassCard>
                );
            default:
                return null;
        }
    };

    return (
        <div className="host-lobby-grid">
            {/* LEFT PANEL */}
            <aside
                className="lobby-panel left-panel"
                onDragOver={onDragOver}
                onDrop={(e) => onDropContainer(e, 'left')}
            >
                {panels.left.map(id => {
                    const content = renderWidget(id);
                    if (!content) return null;
                    return (
                        <ResizableWidget
                            key={id}
                            id={id}
                            panel="left"
                            onDragStart={onDragStart}
                            onDrop={onDrop}
                        >
                            {content}
                        </ResizableWidget>
                    );
                })}
            </aside>

            {/* CENTER PANEL (Static) */}
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
                            <button className="primary-btn pulse-glow" onClick={handleStartHosting} disabled={isStarting || !selectedDisplay}>
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
                                <div key={i} className="peer-slot empty"><span className="material-symbols-outlined">person</span></div>
                            ))}
                        </div>
                    </div>
                )}
            </section>

            {/* RIGHT PANEL */}
            <aside
                className="lobby-panel right-panel"
                onDragOver={onDragOver}
                onDrop={(e) => onDropContainer(e, 'right')}
            >
                {/* Always show Stop Button in default pos if not hosting? No, it's hidden. */}
                {panels.right.map(id => {
                    const content = renderWidget(id);
                    if (!content) return null;
                    return (
                        <ResizableWidget
                            key={id}
                            id={id}
                            panel="right"
                            onDragStart={onDragStart}
                            onDrop={onDrop}
                        >
                            {content}
                        </ResizableWidget>
                    );
                })}
            </aside>

            {/* Audio Setup Modal */}
            <AudioSetupModal
                isOpen={showAudioSetupModal}
                onClose={() => setShowAudioSetupModal(false)}
                onInstallComplete={() => {
                    addLog('[AUDIO] VB-Cable installed successfully');
                }}
            />
        </div>
    );
}
