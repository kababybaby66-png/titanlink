/**
 * AudioBanner - WASAPI loopback requires no driver installation.
 * Stub kept for import compatibility.
 */
import './AudioBanner.css';

interface AudioBannerProps {
    isVisible: boolean;
    onDismiss: () => void;
    onInstall: () => void;
}

export function AudioBanner({ isVisible }: AudioBannerProps) {
    if (!isVisible) return null;
    return null;
}
