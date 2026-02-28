import React from 'react';
import type { DriverCheckResult } from '../../shared/types/ipc';
import { CyberButton } from '../components/CyberButton';
import './DriverWarning.css';

interface DriverWarningProps {
    status: DriverCheckResult | null;
    onClose: () => void;
    onInstall: () => void;
}

export function DriverWarning({ status, onClose, onInstall }: DriverWarningProps) {
    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="driver-warning-panel panel" onClick={(e) => e.stopPropagation()}>
                <div className="panel-header warning-header">
                    <h2 className="text-danger">System Alert: Driver Missing</h2>
                    <div className="header-decoration danger-deco"></div>
                </div>

                <div className="warning-content">
                    <div className="warning-icon">⚠</div>
                    <div className="warning-text">
                        <p className="primary-msg">
                            Controller Driver Required
                        </p>
                        <p className="secondary-msg text-muted">
                            {status?.message || 'Virtual controller emulation driver is missing. Proceed to install required dependencies.'}
                        </p>
                    </div>
                </div>

                <div className="warning-details">
                    <h3 className="tech-label">Component Details</h3>
                    <p className="text-sm">
                        ViGEmBus creates a virtual Xbox controller interface, allowing remote input to be recognized as local hardware.
                    </p>
                </div>

                <div className="actions-row">
                    <CyberButton variant="ghost" onClick={onClose}>
                        Ignore and Continue
                    </CyberButton>
                    <CyberButton variant="danger" onClick={onInstall}>
                        Install Driver
                    </CyberButton>
                </div>
            </div>
        </div>
    );
}
