import React, { useState } from 'react';
import { GlassCard } from '../components/ui/GlassCard';
import './ClientConnect.css';

interface ClientConnectProps {
    onConnect: (sessionCode: string) => Promise<void>;
    onBack: () => void;
    error: string | null;
}

export function ClientConnect({ onConnect, onBack, error }: ClientConnectProps) {
    const [inputCode, setInputCode] = useState('');
    const [isConnecting, setIsConnecting] = useState(false);
    const [localError, setLocalError] = useState<string | null>(null);

    const handleConnect = async (e?: React.FormEvent) => {
        e?.preventDefault();
        if (!inputCode) return;

        setIsConnecting(true);
        setLocalError(null);

        try {
            await onConnect(inputCode);
        } catch (err) {
            setLocalError(err instanceof Error ? err.message : 'Connection failed');
            setIsConnecting(false);
        }
    };

    return (
        <div className="client-connect-page">
            <div className="connect-container">
                <GlassCard className="connect-module" hoverEffect>
                    <div className="module-header">
                        <span className="material-symbols-outlined icon animate-spin-slow">hub</span>
                        <h2>ESTABLISH UPLINK</h2>
                    </div>

                    <form onSubmit={handleConnect} className="connect-form">
                        <div className="input-group">
                            <label className="input-label">TARGET SESSION CODE</label>
                            <div className="input-wrapper">
                                <input
                                    type="text"
                                    value={inputCode}
                                    onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                                    placeholder="XXXX-XXXX-XXXX"
                                    maxLength={20}
                                    className="cyber-input-large"
                                    autoFocus
                                    disabled={isConnecting}
                                />
                                <div className="input-scanline"></div>
                            </div>
                        </div>

                        {(error || localError) && (
                            <div className="error-banner">
                                <span className="material-symbols-outlined">warning</span>
                                <span>{error || localError}</span>
                            </div>
                        )}

                        <div className="telemetry-grid">
                            <div className="telemetry-item">
                                <span className="label">SIGNAL_INTEGRITY</span>
                                <span className="value text-primary">100%</span>
                            </div>
                            <div className="telemetry-item">
                                <span className="label">ENCRYPTION</span>
                                <span className="value text-primary">TLS 1.3</span>
                            </div>
                            <div className="telemetry-item">
                                <span className="label">PROTOCOL</span>
                                <span className="value text-primary">UDP/P2P</span>
                            </div>
                        </div>

                        <div className="actions-row">
                            <button type="button" className="secondary-btn" onClick={onBack}>
                                <span className="material-symbols-outlined">arrow_back</span>
                                ABORT
                            </button>
                            <button
                                type="submit"
                                className="primary-btn"
                                disabled={!inputCode || isConnecting}
                            >
                                {isConnecting ? (
                                    <>
                                        <span className="material-symbols-outlined animate-spin">sync</span>
                                        CONNECTING...
                                    </>
                                ) : (
                                    <>
                                        <span className="material-symbols-outlined">bolt</span>
                                        INITIATE LINK
                                    </>
                                )}
                            </button>
                        </div>
                    </form>
                </GlassCard>
            </div>
        </div>
    );
}
