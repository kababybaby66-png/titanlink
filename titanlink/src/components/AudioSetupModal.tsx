/**
 * AudioSetupModal - Premium audio driver installation modal
 * Installs VB-Cable and auto-configures audio routing for streaming
 */

import { useState, useEffect } from 'react';
import './AudioSetupModal.css';

interface AudioSetupModalProps {
    isOpen: boolean;
    onClose: () => void;
    onInstallComplete?: () => void;
}

type InstallStatus = 'idle' | 'downloading' | 'extracting' | 'installing' | 'configuring' | 'complete' | 'error';

export function AudioSetupModal({ isOpen, onClose, onInstallComplete }: AudioSetupModalProps) {
    const [status, setStatus] = useState<InstallStatus>('idle');
    const [progress, setProgress] = useState(0);
    const [error, setError] = useState<string | null>(null);
    const [isVBCableInstalled, setIsVBCableInstalled] = useState<boolean | null>(null);

    useEffect(() => {
        if (isOpen) {
            // Check if VB-Cable is already installed
            window.electronAPI?.audio?.checkVBCableInstalled().then((result) => {
                setIsVBCableInstalled(result.installed);
            });

            // Listen for progress updates
            const unsubscribe = window.electronAPI?.audio?.onVBCableProgress((data) => {
                setStatus(data.status as InstallStatus);
                if (data.progress !== undefined) {
                    setProgress(data.progress);
                }
                if (data.error) {
                    setError(data.error);
                }
                if (data.status === 'complete') {
                    onInstallComplete?.();
                }
            });

            return () => {
                unsubscribe?.();
            };
        }
    }, [isOpen, onInstallComplete]);

    const handleInstall = async () => {
        setStatus('downloading');
        setProgress(0);
        setError(null);

        try {
            const result = await window.electronAPI?.audio?.installVBCable();
            if (result?.success) {
                setStatus('complete');
                setIsVBCableInstalled(true);
            } else {
                setStatus('error');
                setError(result?.error || 'Installation failed');
            }
        } catch (err) {
            setStatus('error');
            setError((err as Error).message);
        }
    };

    const handleEnableStereoMix = () => {
        // Open Windows Sound settings
        const shell = window.require?.('electron')?.shell;
        if (shell) {
            shell.openExternal('ms-settings:sound');
        } else {
            window.open('ms-settings:sound', '_blank');
        }
    };

    const getProgressText = () => {
        switch (status) {
            case 'downloading':
                return `Downloading VB-Cable... ${progress}%`;
            case 'extracting':
                return 'Extracting driver files...';
            case 'installing':
                return 'Installing driver (Admin prompt)...';
            case 'configuring':
                return 'Configuring audio routing...';
            default:
                return 'Processing...';
        }
    };

    if (!isOpen) return null;

    return (
        <div className="audio-modal-overlay" onClick={onClose}>
            <div className="audio-modal" onClick={(e) => e.stopPropagation()}>
                <button className="audio-modal-close" onClick={onClose}>
                    <span className="material-symbols-outlined">close</span>
                </button>

                {/* Header */}
                <div className="audio-modal-icon">
                    <div className="icon-wrapper">
                        <span className="material-symbols-outlined">graphic_eq</span>
                    </div>
                </div>
                <h2>System Audio Setup</h2>
                <p className="audio-modal-description">
                    Enable system audio streaming to share game sounds, music, and other audio with your guests.
                </p>

                {/* Already Installed Notice */}
                {isVBCableInstalled === true && status === 'idle' && (
                    <div className="audio-status-success">
                        <span className="material-symbols-outlined">check_circle</span>
                        VB-Cable is installed! Restart the app to enable audio.
                    </div>
                )}

                {/* Options */}
                {status === 'idle' && (
                    <div className="audio-options">
                        {/* VB-Cable Option */}
                        <div className="audio-option recommended">
                            <h3>
                                <span className="material-symbols-outlined">download</span>
                                VB-Audio Virtual Cable
                            </h3>
                            <p>
                                Install a virtual audio device that captures all system sounds.
                                Auto-configures for streaming while you still hear your own audio.
                            </p>
                            <button className="audio-btn primary" onClick={handleInstall}>
                                <span className="material-symbols-outlined">install_desktop</span>
                                Install VB-Cable
                            </button>
                            <div className="audio-note">
                                <span className="badge">
                                    <span className="material-symbols-outlined" style={{ fontSize: '10px' }}>verified</span>
                                    FREE
                                </span>
                                ~1MB download • Requires admin
                            </div>
                            <div className="audio-features">
                                <span className="audio-feature">
                                    <span className="material-symbols-outlined">auto_mode</span>
                                    Auto-config
                                </span>
                                <span className="audio-feature">
                                    <span className="material-symbols-outlined">headphones</span>
                                    Hear locally
                                </span>
                                <span className="audio-feature">
                                    <span className="material-symbols-outlined">restart_alt</span>
                                    Auto-cleanup
                                </span>
                            </div>
                        </div>

                        <div className="audio-divider">or</div>

                        {/* Stereo Mix Option */}
                        <div className="audio-option">
                            <h3>
                                <span className="material-symbols-outlined">settings_suggest</span>
                                Windows Stereo Mix
                            </h3>
                            <p>
                                Use Windows built-in loopback audio (if your sound card supports it).
                            </p>
                            <button className="audio-btn secondary" onClick={handleEnableStereoMix}>
                                <span className="material-symbols-outlined">open_in_new</span>
                                Open Sound Settings
                            </button>
                            <div className="audio-note">
                                Recording tab → Show Disabled Devices → Enable "Stereo Mix"
                            </div>
                        </div>
                    </div>
                )}

                {/* Progress State */}
                {(status === 'downloading' || status === 'extracting' || status === 'installing' || status === 'configuring') && (
                    <div className="audio-progress">
                        <div className="audio-progress-spinner" />
                        <div className="audio-progress-bar">
                            <div
                                className="audio-progress-fill"
                                style={{ width: `${status === 'downloading' ? progress : 100}%` }}
                            />
                        </div>
                        <p className="audio-progress-text">{getProgressText()}</p>
                    </div>
                )}

                {/* Complete State */}
                {status === 'complete' && (
                    <div className="audio-complete">
                        <div className="audio-success-icon">✓</div>
                        <h3>Installation Complete!</h3>
                        <p>
                            VB-Cable has been installed and configured.
                            Restart the app to start streaming with audio.
                        </p>
                        <div className="audio-auto-config">
                            <div className="audio-auto-config-label">Audio Routing</div>
                            <div className="audio-auto-config-status">
                                <span className="dot" />
                                Ready - Will activate when hosting
                            </div>
                        </div>
                        <button
                            className="audio-btn primary"
                            onClick={onClose}
                            style={{ marginTop: '20px' }}
                        >
                            <span className="material-symbols-outlined">check</span>
                            Done
                        </button>
                    </div>
                )}

                {/* Error State */}
                {status === 'error' && (
                    <div className="audio-error">
                        <div className="audio-error-icon">⚠</div>
                        <h3>Installation Failed</h3>
                        <p>{error || 'An unknown error occurred'}</p>
                        <button className="audio-btn secondary" onClick={() => setStatus('idle')}>
                            <span className="material-symbols-outlined">refresh</span>
                            Try Again
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
}
