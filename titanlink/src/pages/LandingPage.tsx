import React, { useEffect, useState, useCallback } from 'react';
import { GlassCard } from '../components/ui/GlassCard';
import { CircuitNetwork } from '../components/ui/CircuitNetwork';
import './LandingPage.css';

interface LandingPageProps {
    onHostClick: () => void;
    onConnectClick: () => void;
    onSettingsClick: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({
    onHostClick,
    onConnectClick,
    onSettingsClick
}) => {
    const [scrambleText, setScrambleText] = useState('SYSTEM_READY');
    const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

    // Mouse tracking for glow effect
    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        setMousePos({
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
        });
    }, []);

    // Simple scramble effect on mount
    useEffect(() => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_#@';
        let iter = 0;
        const target = 'SYSTEM_READY';

        const interval = setInterval(() => {
            setScrambleText(target.split('').map((c, i) => {
                if (i < iter) return c;
                return chars[Math.floor(Math.random() * chars.length)];
            }).join(''));

            if (iter >= target.length) clearInterval(interval);
            iter += 1 / 3;
        }, 50);

        return () => clearInterval(interval);
    }, []);

    return (
        <div
            className="landing-page"
            onMouseMove={handleMouseMove}
            style={{
                '--mouse-x': `${mousePos.x}px`,
                '--mouse-y': `${mousePos.y}px`,
            } as React.CSSProperties}
        >
            {/* Mouse-following glow effect */}
            <div className="mouse-glow" />
            <div className="mouse-glow-secondary" />

            {/* Background elements */}
            <div className="grid-overlay"></div>
            <div className="orbital-ring"></div>

            {/* Circuit Network - Neural Network Particle System */}
            <div style={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none' }}>
                <CircuitNetwork
                    nodeCount={180}
                    connectionDistance={280}
                    mouseRadius={280}
                    primaryColor="#00f2ff"
                    secondaryColor="#4abdff"
                />
            </div>

            <div className="landing-layout">
                {/* HEAD & STATUS */}
                <header className="landing-head">
                    <div className="brand-lockup">
                        <div className="logo-glitch" data-text="TITANLINK">TITANLINK</div>
                        <div className="version-tag">Build v1.0.4 // STABLE</div>
                    </div>

                    <div className="system-status-pill">
                        <span className="status-dot"></span>
                        <span className="status-text">{scrambleText}</span>
                    </div>
                </header>

                {/* MAIN ACTIONS */}
                <div className="actions-stage">
                    {/* HOST ACTION */}
                    <GlassCard className="action-panel host-panel" hoverEffect={true}>
                        <div className="panel-content" onClick={onHostClick}>
                            <div className="panel-decoration top-right"></div>
                            <div className="icon-frame">
                                <span className="material-symbols-outlined">broadcast_on_personal</span>
                            </div>
                            <h2 className="panel-title">INITIATE HOST</h2>
                            <p className="panel-desc">Broadcast local neural feed to remote clients.</p>

                            <div className="panel-footer">
                                <span className="cmd-prompt">&gt; EXECUTE_PROTOCOL</span>
                                <span className="material-symbols-outlined arrow">arrow_forward</span>
                            </div>
                            <div className="scanline"></div>
                        </div>
                    </GlassCard>

                    {/* CONNECT ACTION */}
                    <GlassCard className="action-panel client-panel" hoverEffect={true}>
                        <div className="panel-content" onClick={onConnectClick}>
                            <div className="panel-decoration top-right"></div>
                            <div className="icon-frame">
                                <span className="material-symbols-outlined">link</span>
                            </div>
                            <h2 className="panel-title">JOIN SESSION</h2>
                            <p className="panel-desc">Establish secure uplink to existing beacon.</p>

                            <div className="panel-footer">
                                <span className="cmd-prompt">&gt; CONNECT_REMOTE</span>
                                <span className="material-symbols-outlined arrow">arrow_forward</span>
                            </div>
                            <div className="scanline"></div>
                        </div>
                    </GlassCard>
                </div>

                {/* FOOTER / SETTINGS */}
                <footer className="landing-foot">
                    <GlassCard className="utility-bar">
                        <div className="utility-item" onClick={onSettingsClick}>
                            <span className="material-symbols-outlined">tune</span>
                            <span>CONFIGURATION</span>
                        </div>
                        <div className="separator"></div>
                        <div className="utility-item">
                            <span className="material-symbols-outlined">help</span>
                            <span>MANUAL</span>
                        </div>
                        <div className="separator"></div>
                        <div className="utility-item inactive">
                            <span className="material-symbols-outlined">security</span>
                            <span>SECURE_BOOT: ON</span>
                        </div>
                    </GlassCard>
                </footer>
            </div>
        </div>
    );
};
