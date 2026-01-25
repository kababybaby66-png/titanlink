import React from 'react';
import './StatusBadge.css';

interface StatusBadgeProps {
    status: 'online' | 'offline' | 'busy' | 'live' | 'error';
    label?: string;
    pulse?: boolean;
}

export const StatusBadge: React.FC<StatusBadgeProps> = ({
    status,
    label,
    pulse = false
}) => {
    const defaultLabels = {
        online: 'ONLINE',
        offline: 'OFFLINE',
        busy: 'BUSY',
        live: 'LIVE',
        error: 'ERROR'
    };

    return (
        <div className={`status-badge status-badge--${status}`}>
            <div className={`status-dot ${pulse ? 'animate-pulse' : ''}`}></div>
            <span className="status-label">{label || defaultLabels[status]}</span>
        </div>
    );
};
