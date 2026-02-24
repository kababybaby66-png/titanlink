/**
 * AudioSetupModal — removed.
 * WASAPI loopback captures system audio natively; no driver required.
 * Stub kept for import compatibility.
 */
import './AudioSetupModal.css';

interface AudioSetupModalProps {
    isOpen: boolean;
    onClose: () => void;
    onInstallComplete?: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function AudioSetupModal(_props: AudioSetupModalProps) {
    return null;
}
