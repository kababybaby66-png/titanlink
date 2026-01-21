import React from 'react';
import './CyberButton.css';

interface CyberButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
    size?: 'sm' | 'md' | 'lg';
    icon?: React.ReactNode;
    glitch?: boolean;
}

export const CyberButton: React.FC<CyberButtonProps> = ({
    children,
    variant = 'primary',
    size = 'md',
    icon,
    glitch = false,
    className = '',
    ...props
}) => {
    return (
        <button
            className={`cyber-btn cyber-btn--${variant} cyber-btn--${size} ${glitch ? 'cyber-glitch' : ''} ${className}`}
            {...props}
        >
            <div className="cyber-btn__content">
                {icon && <span className="cyber-btn__icon">{icon}</span>}
                <span className="cyber-btn__text">{children}</span>
            </div>
            <div className="cyber-btn__glare"></div>
            <div className="cyber-btn__tag"></div>
        </button>
    );
};
