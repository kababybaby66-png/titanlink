import React, { useState, useEffect } from 'react';
import './Titlebar.css';

export const Titlebar = () => {
    const [updateReady, setUpdateReady] = useState(false);
    const [updateProgress, setUpdateProgress] = useState<number | null>(null);
    const [updateStatus, setUpdateStatus] = useState<string>('');

    useEffect(() => {
        if (!window.electronAPI?.updater) return;

        const cleanupStatus = window.electronAPI.updater.onStatusChange((status) => {
            console.log('[Titlebar] Auto-updater status:', status);
            setUpdateStatus(status);
            if (status === 'downloaded') {
                setUpdateReady(true);
                setUpdateProgress(null);
            } else if (status === 'checking' || status === 'available') {
                setUpdateProgress(0);
            } else if (status === 'not-available' || status === 'error') {
                setUpdateProgress(null);
            }
        });

        let cleanupProgress: (() => void) | undefined;
        if (window.electronAPI.updater.onDownloadProgress) {
            cleanupProgress = window.electronAPI.updater.onDownloadProgress((progressObj) => {
                setUpdateProgress(Math.round(progressObj.percent));
            });
        }

        return () => {
            cleanupStatus();
            if (cleanupProgress) cleanupProgress();
        };
    }, []);

    const handleRestart = () => {
        window.electronAPI?.updater.restartAndInstall();
    };

    const handleMinimize = () => {
        window.electronAPI?.window.minimize();
    };

    const handleMaximize = () => {
        window.electronAPI?.window.maximize();
    };

    const handleClose = () => {
        window.electronAPI?.window.close();
    };

    return (
        <header className="titlebar">
            <div className="titlebar-drag-region" />

            <div className="titlebar-left">
                <div className="flex items-center gap-3 text-white app-logo">
                    <div className="size-6 text-primary animate-pulse">
                        <span className="material-symbols-outlined logo-icon">hub</span>
                    </div>
                    <div className="flex flex-col">
                        <h2 className="text-white text-sm font-bold tracking-widest uppercase">TitanLink // Client</h2>
                        <span className="text-[10px] text-primary/70 font-mono leading-none sys-status">System: Online</span>
                    </div>
                </div>
            </div>

            <div className="titlebar-controls">
                {updateProgress !== null && !updateReady && (
                    <div className="flex items-center gap-2 mr-4 text-xs font-mono text-primary/80 mt-1">
                        <span className="material-symbols-outlined text-[14px] animate-bounce">download</span>
                        <span>{updateStatus === 'checking' ? 'Checking...' : `DL ${updateProgress}%`}</span>
                    </div>
                )}
                {updateReady && (
                    <button className="update-ready-btn" onClick={handleRestart} title="Update Ready! Click to Restart">
                        <span className="material-symbols-outlined text-[16px]">system_update_alt</span>
                        <span className="btn-text">Update Ready</span>
                    </button>
                )}
                <button onClick={handleMinimize} className="control-btn minimize" title="Minimize">
                    <span className="material-symbols-outlined icon">minimize</span>
                </button>
                <button onClick={handleMaximize} className="control-btn maximize" title="Maximize">
                    <span className="material-symbols-outlined icon">crop_square</span>
                </button>
                <button onClick={handleClose} className="control-btn close" title="Close">
                    <span className="material-symbols-outlined icon">close</span>
                </button>
            </div>
        </header>
    );
};
