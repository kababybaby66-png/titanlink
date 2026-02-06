/**
 * AudioBanner - Minimal, non-intrusive audio setup prompt
 * Replaces the annoying modal with a subtle inline banner
 */

import { useState, useEffect } from 'react';
import './AudioBanner.css';

interface AudioBannerProps {
    isVisible: boolean;
    onDismiss: () => void;
    onInstall: () => void;
}

export function AudioBanner({ isVisible, onDismiss, onInstall }: AudioBannerProps) {
    const [isInstalling, setIsInstalling] = useState(false);
    const [installStatus, setInstallStatus] = useState<'idle' | 'progress' | 'done' | 'error'>('idle');
    const [progress, setProgress] = useState(0);

    useEffect(() => {
        if (!isVisible) return;

        // Listen for progress updates
        const unsubscribe = window.electronAPI?.audio?.onVBCableProgress((data) => {
            if (data.status === 'downloading') {
                setInstallStatus('progress');
                setProgress(data.progress || 0);
            } else if (data.status === 'complete') {
                setInstallStatus('done');
                setTimeout(onDismiss, 2000);
            } else if (data.status === 'error') {
                setInstallStatus('error');
            }
        });

        return () => unsubscribe?.();
    }, [isVisible, onDismiss]);

    const handleInstall = async () => {
        setIsInstalling(true);
        setInstallStatus('progress');

        try {
            const result = await window.electronAPI?.audio?.installVBCable();
            if (result?.success) {
                setInstallStatus('done');
                onInstall();
            } else {
                setInstallStatus('error');
            }
        } catch {
            setInstallStatus('error');
        } finally {
            setIsInstalling(false);
        }
    };

    if (!isVisible) return null;

    return (
        <div className="audio-banner">
            <div className="audio-banner-content">
                {installStatus === 'idle' && (
                    <>
                        <div className="audio-banner-icon">
                            <span className="material-symbols-outlined">volume_off</span>
                        </div>
                        <div className="audio-banner-text">
                            <span className="audio-banner-title">Audio Disabled</span>
                            <span className="audio-banner-subtitle">Install VB-Cable for system audio</span>
                        </div>
                        <div className="audio-banner-actions">
                            <button
                                className="audio-banner-btn primary"
                                onClick={handleInstall}
                                disabled={isInstalling}
                            >
                                <span className="material-symbols-outlined">download</span>
                                Install
                            </button>
                            <button
                                className="audio-banner-btn secondary"
                                onClick={onDismiss}
                            >
                                <span className="material-symbols-outlined">close</span>
                            </button>
                        </div>
                    </>
                )}

                {installStatus === 'progress' && (
                    <>
                        <div className="audio-banner-spinner" />
                        <div className="audio-banner-text">
                            <span className="audio-banner-title">Installing VB-Cable...</span>
                            <div className="audio-banner-progress">
                                <div
                                    className="audio-banner-progress-fill"
                                    style={{ width: `${progress}%` }}
                                />
                            </div>
                        </div>
                    </>
                )}

                {installStatus === 'done' && (
                    <>
                        <div className="audio-banner-icon success">
                            <span className="material-symbols-outlined">check_circle</span>
                        </div>
                        <div className="audio-banner-text">
                            <span className="audio-banner-title success">Audio Ready!</span>
                            <span className="audio-banner-subtitle">Restart to enable audio streaming</span>
                        </div>
                    </>
                )}

                {installStatus === 'error' && (
                    <>
                        <div className="audio-banner-icon error">
                            <span className="material-symbols-outlined">error</span>
                        </div>
                        <div className="audio-banner-text">
                            <span className="audio-banner-title error">Install Failed</span>
                            <span className="audio-banner-subtitle">Try manual download from vb-audio.com</span>
                        </div>
                        <button
                            className="audio-banner-btn secondary"
                            onClick={onDismiss}
                        >
                            <span className="material-symbols-outlined">close</span>
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
