import React from 'react';
import './GlassCard.css';

interface GlassCardProps {
    children: React.ReactNode;
    className?: string;
    hoverEffect?: boolean;
    style?: React.CSSProperties;
}

export const GlassCard: React.FC<GlassCardProps> = ({
    children,
    className = '',
    hoverEffect = false,
    style
}) => {
    return (
        <div className={`glass-card ${hoverEffect ? 'glass-card--hover' : ''} ${className}`} style={style}>
            {children}
            {/* Corner Accents */}
            <div className="glass-card__corner glass-card__corner--tl"></div>
            <div className="glass-card__corner glass-card__corner--tr"></div>
            <div className="glass-card__corner glass-card__corner--bl"></div>
            <div className="glass-card__corner glass-card__corner--br"></div>
        </div>
    );
};
