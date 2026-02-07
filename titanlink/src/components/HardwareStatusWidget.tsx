import { useState, useEffect } from 'react';
import { GlassCard } from './ui/GlassCard';

interface HardwareSupport {
    nvenc: boolean;
    software: boolean;
}

/**
 * Hardware Status Widget
 * Displays hardware encoding capabilities (NVENC, Software)
 */
export function HardwareStatusWidget() {
    const [hwSupport, setHwSupport] = useState<HardwareSupport>({
        nvenc: false,
        software: false,
    });

    useEffect(() => {
        const checkHardwareSupport = async () => {
            try {
                if (window.electronAPI?.hardwareCapture) {
                    const support = await window.electronAPI.hardwareCapture.isSupported();
                    setHwSupport(support);
                }
            } catch (error) {
                console.warn('[Hardware] Failed to check hardware support:', error);
            }
        };

        checkHardwareSupport();
    }, []);

    return (
        <GlassCard className="info-card hardware-status-card">
            <div className="card-header">
                <span className="material-symbols-outlined icon">bolt</span>
                <span className="title">HARDWARE</span>
            </div>
            <div className="hw-status-grid">
                <div className={`hw-item ${hwSupport.nvenc ? 'active' : 'inactive'}`}>
                    <span className="label">NVENC</span>
                    <span className="status-dot"></span>
                </div>
                <div className={`hw-item ${hwSupport.software ? 'active' : 'inactive'}`}>
                    <span className="label">SW_CAP</span>
                    <span className="status-dot"></span>
                </div>
            </div>
            <div className="card-sub">PIPELINE: DXGI_DD</div>
        </GlassCard>
    );
}
