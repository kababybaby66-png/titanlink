import React, { useState } from 'react';
import { CyberButton } from '../components/CyberButton';
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
            <div className="connect-module panel">
                <div className="module-header">
                    <h2 className="text-cyan">TARGET UPLINK</h2>
                    <div className="target-reticle"></div>
                </div>

                <form onSubmit={handleConnect} className="connect-form">
                    <label className="tech-label">ENTER TARGET COORDINATES (SESSION CODE)</label>
                    <div className="input-group">
                        <input
                            type="text"
                            value={inputCode}
                            onChange={(e) => setInputCode(e.target.value.toUpperCase())}
                            placeholder="XXXX-XXXX-XXXX"
                            maxLength={20}
                            className="cyber-input"
                            autoFocus
                            disabled={isConnecting}
                        />
                        <div className="input-decoration"></div>
                    </div>

                    {(error || localError) && (
                        <div className="error-message text-danger animate-glitch">
                            [ERROR]: {error || localError}
                        </div>
                    )}

                    <div className="telemetry-readout">
                        <div className="readout-item">
                            <span className="label">SIGNAL_STRENGTH</span>
                            <span className="val text-success">100%</span>
                        </div>
                        <div className="readout-item">
                            <span className="label">ENCRYPTION</span>
                            <span className="val text-cyan">AES-256</span>
                        </div>
                    </div>

                    <div className="actions-row">
                        <CyberButton variant="secondary" onClick={onBack} type="button">
                            CANCEL
                        </CyberButton>
                        <CyberButton
                            variant="primary"
                            type="submit"
                            disabled={!inputCode || isConnecting}
                            glitch={isConnecting}
                        >
                            {isConnecting ? 'ESTABLISHING LINK...' : 'INITIATE JUMP'}
                        </CyberButton>
                    </div>
                </form>
            </div>
        </div>
    );
}
