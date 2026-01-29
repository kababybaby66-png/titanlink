import React, { useState, useEffect } from 'react';
import { HoloCanvas, ResourceReactor } from './3d'; // Adjust import based on where this file is placed
import './StatusVisualizer.css';

interface StatusVisualizerProps {
    cpuUsage?: number;
    memUsage?: number;
    mode?: 'stats' | 'input'; // Allow toggling if we want
}

export const StatusVisualizer = ({ cpuUsage = 0, memUsage = 0 }: StatusVisualizerProps) => {
    return (
        <div className="glass-panel clip-bevel status-visualizer-panel">
            <h3 className="text-primary font-display uppercase tracking-widest status-visualizer-title">
                System Core
            </h3>
            <div className="status-viewport">
                <HoloCanvas>
                    <ResourceReactor cpuUsage={cpuUsage} memUsage={memUsage} />
                </HoloCanvas>
            </div>
        </div>
    )
}
