import React from 'react';
import './BackgroundEffects.css';

export const BackgroundEffects = () => {
    return (
        <div className="bg-effects-container">
            <div className="grid-overlay"></div>
            <div className="vignette"></div>
            <div className="particles"></div>
        </div>
    );
};
