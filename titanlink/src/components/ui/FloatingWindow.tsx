import React, { useState, useRef, useEffect, ReactNode } from 'react';
import './FloatingWindow.css';

interface FloatingWindowProps {
    title: string;
    onClose: () => void;
    initialPosition?: { x: number; y: number };
    initialSize?: { width: number; height: number };
    minSize?: { width: number; height: number };
    children: ReactNode;
    icon?: string;
    isActive?: boolean;
    onFocus?: () => void;
    className?: string;
}

export const FloatingWindow: React.FC<FloatingWindowProps> = ({
    title,
    onClose,
    initialPosition = { x: 100, y: 100 },
    initialSize = { width: 300, height: 200 },
    minSize = { width: 150, height: 100 },
    children,
    icon = 'app_registration',
    isActive = false,
    onFocus,
    className = ''
}) => {
    const [position, setPosition] = useState(initialPosition);
    const [size, setSize] = useState(initialSize);
    const [isDragging, setIsDragging] = useState(false);
    const [isResizing, setIsResizing] = useState(false);
    const windowRef = useRef<HTMLDivElement>(null);
    const dragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const resizeStartRef = useRef<{ x: number; y: number; width: number; height: number }>({ x: 0, y: 0, width: 0, height: 0 });

    // Handle Dragging
    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.target instanceof Element && e.target.closest('.window-controls')) return;

        onFocus?.();
        setIsDragging(true);
        dragStartRef.current = {
            x: e.clientX - position.x,
            y: e.clientY - position.y
        };
    };

    // Handle Resizing
    const handleResizeStart = (e: React.MouseEvent) => {
        e.stopPropagation();
        onFocus?.();
        setIsResizing(true);
        resizeStartRef.current = {
            x: e.clientX,
            y: e.clientY,
            width: size.width,
            height: size.height
        };
    };

    useEffect(() => {
        const handleMouseMove = (e: MouseEvent) => {
            if (isDragging) {
                setPosition({
                    x: e.clientX - dragStartRef.current.x,
                    y: e.clientY - dragStartRef.current.y
                });
            } else if (isResizing) {
                const deltaX = e.clientX - resizeStartRef.current.x;
                const deltaY = e.clientY - resizeStartRef.current.y;

                setSize({
                    width: Math.max(minSize.width, resizeStartRef.current.width + deltaX),
                    height: Math.max(minSize.height, resizeStartRef.current.height + deltaY)
                });
            }
        };

        const handleMouseUp = () => {
            setIsDragging(false);
            setIsResizing(false);
        };

        if (isDragging || isResizing) {
            document.addEventListener('mousemove', handleMouseMove);
            document.addEventListener('mouseup', handleMouseUp);
        }

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDragging, isResizing, minSize]);

    return (
        <div
            className={`floating-window ${isActive ? 'active' : ''} ${className}`}
            style={{
                left: position.x,
                top: position.y,
                width: size.width,
                height: size.height,
                zIndex: isActive ? 100 : 10
            }}
            ref={windowRef}
        >
            <div className="window-header" onMouseDown={handleMouseDown}>
                <div className="window-title-area">
                    <span className="material-symbols-outlined window-icon">{icon}</span>
                    <span className="window-title">{title}</span>
                </div>
                <div className="window-controls">
                    <button className="win-btn minimize" title="Minimize">
                        <span className="material-symbols-outlined">minimize</span>
                    </button>
                    <button className="win-btn maximize" title="Maximize">
                        <span className="material-symbols-outlined">crop_square</span>
                    </button>
                    <button className="win-btn close" onClick={(e) => { e.stopPropagation(); onClose(); }} title="Close">
                        <span className="material-symbols-outlined">close</span>
                    </button>
                </div>
            </div>
            <div className="window-content" onMouseDown={() => onFocus?.()}>
                {children}
            </div>
            <div className="resize-handle" onMouseDown={handleResizeStart}></div>
        </div>
    );
};
