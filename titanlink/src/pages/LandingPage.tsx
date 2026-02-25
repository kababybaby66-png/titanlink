import React, { useEffect, useState, useRef, useCallback } from 'react';
import { GlassCard } from '../components/ui/GlassCard';
import { CircuitNetwork } from '../components/ui/CircuitNetwork';
import './LandingPage.css';

interface LandingPageProps {
    onHostClick: () => void;
    onConnectClick: () => void;
    onSettingsClick: () => void;
    enableBackgroundAnimation?: boolean;
}

export const LandingPage: React.FC<LandingPageProps> = ({
    onHostClick,
    onConnectClick,
    onSettingsClick,
    enableBackgroundAnimation = false
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [scrambleText, setScrambleText] = useState('SYSTEM_READY');

    // Optimized mouse tracking without re-renders
    const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (!enableBackgroundAnimation || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        containerRef.current.style.setProperty('--mouse-x', `${x}px`);
        containerRef.current.style.setProperty('--mouse-y', `${y}px`);
    }, [enableBackgroundAnimation]);

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
            ref={containerRef}
            className={`landing-page ${enableBackgroundAnimation ? 'animated-bg' : ''}`}
            onMouseMove={handleMouseMove}
        >
            {/* Mouse-following glow effect */}
            {enableBackgroundAnimation && (
                <>
                    <div className="mouse-glow" />
                    <div className="mouse-glow-secondary" />
                </>
            )}

            {/* Background elements */}
            <div className={`grid-overlay ${enableBackgroundAnimation ? 'animated' : ''}`}></div>
            <div className={`orbital-ring ${enableBackgroundAnimation ? 'animated' : ''}`}></div>

            {/* Circuit Network */}
            <div style={{ position: 'absolute', inset: 0, zIndex: 1, pointerEvents: 'none' }}>
                <CircuitNetwork
                    nodeCount={130}
                    connectionDistance={280}
                    primaryColor="#00f2ff"
                    secondaryColor="#4abdff"
                    animated={enableBackgroundAnimation}
                />
            </div>

            <div className="landing-layout">
                {/* HEAD & STATUS */}
                <header className="landing-head">
                    <div className="brand-lockup">
                        <div className="logo-glitch" data-text="TITANLINK">TITANLINK</div>
                        <div className="version-tag">Build v1.2.0 // STABLE</div>
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
