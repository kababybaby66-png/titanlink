import React, { useState, useEffect } from 'react';
import { HoloCanvas, ResourceReactor } from './3d'; // Adjust import based on where this file is placed
import './StatusVisualizer.css';

interface StatusVisualizerProps {
    cpuUsage?: number;
    memUsage?: number;
    mode?: 'stats' | 'input'; // Allow toggling if we want
    enable3D?: boolean;
}

export const StatusVisualizer = ({ cpuUsage = 0, memUsage = 0, enable3D = false }: StatusVisualizerProps) => {
    return (
        <div className="glass-panel clip-bevel status-visualizer-panel">
            <h3 className="text-primary font-display uppercase tracking-widest status-visualizer-title">
                System Core
            </h3>
            <div className="status-viewport">
                {enable3D ? (
                    <HoloCanvas>
                        <ResourceReactor cpuUsage={cpuUsage} memUsage={memUsage} />
                    </HoloCanvas>
                ) : (
                    <div className="static-core-fallback">
                        <div className="static-core-ring" style={{ width: '40px', height: '40px', border: '1px solid #4abdff', borderRadius: '50%', margin: '0 auto', top: '50%', position: 'relative', transform: 'translateY(-50%)', opacity: 0.5 }}></div>
                        <div className="static-core-sphere" style={{ width: '20px', height: '20px', backgroundColor: '#00f2ff', borderRadius: '50%', margin: '0 auto', top: '50%', position: 'absolute', left: '50%', transform: 'translate(-50%, -50%)', boxShadow: '0 0 10px #00f2ff', opacity: 0.8 }}></div>
                    </div>
                )}
            </div>
        </div>
    )
}
