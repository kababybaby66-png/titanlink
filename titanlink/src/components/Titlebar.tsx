import React, { useEffect, useState } from 'react';
import './Titlebar.css';

export const Titlebar = () => {
    const [isMaximized, setIsMaximized] = useState(false);
    const [fps, setFps] = useState(0);

    // Simulate FPS counter for "Live Telemetry" feel
    useEffect(() => {
        const interval = setInterval(() => {
            setFps(Math.floor(58 + Math.random() * 4));
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    const handleMinimize = () => {
        window.electronAPI?.window.minimize();
    };

    const handleMaximize = () => {
        window.electronAPI?.window.maximize();
        setIsMaximized(!isMaximized);
    };

    const handleClose = () => {
        window.electronAPI?.window.close();
    };

    return (
        <header className="titlebar">
            <div className="titlebar-drag-region" />

            <div className="titlebar-left">
                <div className="app-logo">
                    <span className="logo-icon">◈</span>
                    <span className="logo-text">TITAN<span className="text-cyan">LINK</span></span>
                </div>
                <div className="telemetry-pill">
                    <span className="status-dot online"></span>
                    <span className="system-status">SYS.ONLINE</span>
                </div>
            </div>

            <div className="titlebar-center">
                <span className="scan-line"></span>
                <span className="monitor-text">MONITORING // {fps} FPS</span>
            </div>

            <div className="titlebar-controls">
                <button onClick={handleMinimize} className="control-btn minimize" title="Minimize">
                    <span className="icon">_</span>
                </button>
                <button onClick={handleMaximize} className="control-btn maximize" title="Maximize">
                    <span className="icon">□</span>
                </button>
                <button onClick={handleClose} className="control-btn close" title="Close">
                    <span className="icon">✕</span>
                </button>
            </div>
        </header>
    );
};
