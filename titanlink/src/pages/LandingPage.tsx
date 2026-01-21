import React from 'react';
import { CyberButton } from '../components/CyberButton';
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
    return (
        <div className="landing-page">
            <div className="landing-content">
                <div className="landing-header">
                    <h1 className="hero-title">TITAN<span className="text-cyan">LINK</span></h1>
                    <div className="hero-subtitle">
                        <span className="status-indicator"></span>
                        SECURE NEURAL UPLINK READY
                    </div>
                </div>

                <div className="action-grid">
                    <div className="action-card host-card" onClick={onHostClick}>
                        <div className="card-glare"></div>
                        <div className="card-content">
                            <div className="card-icon">◈</div>
                            <h2>HOST SESSION</h2>
                            <p>Initialize transmission beacon. Allow remote neural interface.</p>
                            <div className="card-footer">
                                <span className="cmd-text">EXECUTE BEACON_INIT</span>
                                <span className="arrow">→</span>
                            </div>
                        </div>
                    </div>

                    <div className="action-card connect-card" onClick={onConnectClick}>
                        <div className="card-glare"></div>
                        <div className="card-content">
                            <div className="card-icon">⚡</div>
                            <h2>CONNECT</h2>
                            <p>Establish link to remote beacon. Low latency synchronization.</p>
                            <div className="card-footer">
                                <span className="cmd-text">EXECUTE UPLINK_SYNC</span>
                                <span className="arrow">→</span>
                            </div>
                        </div>
                    </div>
                </div>

                <div className="landing-footer">
                    <CyberButton
                        variant="ghost"
                        onClick={onSettingsClick}
                        className="settings-btn"
                    >
                        [ SYSTEM CONFIGURATION ]
                    </CyberButton>
                </div>
            </div>

            <div className="scanline-overlay"></div>
        </div>
    );
};
