/**
 * CircuitNetwork - Cyberpunk neural network particle system
 *
 * Renders either as a static high-res background or fully animated system 
 * based on the 'animated' prop.
 */

import React, { useEffect, useRef } from 'react';

interface CircuitNetworkProps {
    nodeCount?: number;
    connectionDistance?: number;
    mouseRadius?: number;
    primaryColor?: string;
    secondaryColor?: string;
    animated?: boolean;
}

interface Node {
    x: number;
    y: number;
    originX: number;
    originY: number;
    vx: number;
    vy: number;
    z: number;
    size: number;
    pulsePhase: number;
    connections: number[];
}

interface DataPulse {
    fromNode: number;
    toNode: number;
    progress: number;
    speed: number;
    color: string;
}

interface MicroParticle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    alpha: number;
    twinklePhase: number;
}

export const CircuitNetwork: React.FC<CircuitNetworkProps> = ({
    nodeCount = 130,
    connectionDistance = 280,
    mouseRadius = 250,
    primaryColor = '#00f2ff',
    secondaryColor = '#4abdff',
    animated = false,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // Handle high-DPI displays to prevent "low res" look
        const pixelRatio = window.devicePixelRatio || 1;
        let width = window.innerWidth;
        let height = window.innerHeight;

        const updateCanvasSize = () => {
            width = window.innerWidth;
            height = window.innerHeight;
            canvas.width = width * pixelRatio;
            canvas.height = height * pixelRatio;
            canvas.style.width = width + 'px';
            canvas.style.height = height + 'px';
            ctx.scale(pixelRatio, pixelRatio);
        };
        updateCanvasSize();

        // Data arrays
        let nodes: Node[] = [];
        let pulses: DataPulse[] = [];
        let microParticles: MicroParticle[] = [];
        let mouseX = -1000;
        let mouseY = -1000;

        // Configuration
        const friction = 0.92;
        const returnForce = 0.008;
        const parallaxStrength = animated ? 30 : 0;
        const minConnections = 3;
        const maxConnections = 6;

        const initMicroParticles = () => {
            microParticles = [];
            const microCount = Math.floor(width * height / 15000);
            for (let i = 0; i < microCount; i++) {
                microParticles.push({
                    x: Math.random() * width,
                    y: Math.random() * height,
                    vx: (Math.random() - 0.5) * 0.2,
                    vy: (Math.random() - 0.5) * 0.2,
                    size: Math.random() * 1.5 + 0.5,
                    alpha: Math.random() * 0.25 + 0.1,
                    twinklePhase: Math.random() * Math.PI * 2,
                });
            }
        };

        const updateConnections = () => {
            nodes.forEach(node => node.connections = []);
            nodes.forEach((node, i) => {
                const distances: { idx: number; dist: number }[] = [];
                nodes.forEach((other, j) => {
                    if (i === j) return;
                    const dx = node.x - other.x;
                    const dy = node.y - other.y;
                    if (Math.abs(dx) > connectionDistance || Math.abs(dy) > connectionDistance) return;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < connectionDistance) {
                        distances.push({ idx: j, dist });
                    }
                });
                distances.sort((a, b) => a.dist - b.dist);
                const connectionCount = minConnections + Math.floor(Math.random() * (maxConnections - minConnections + 1));
                for (let c = 0; c < Math.min(connectionCount, distances.length); c++) {
                    const targetIdx = distances[c].idx;
                    if (i < targetIdx && !node.connections.includes(targetIdx)) {
                        node.connections.push(targetIdx);
                    }
                }
            });
        };

        const initNodesWithGrid = () => {
            nodes = [];
            const gridCount = Math.floor(nodeCount * 0.6);
            const cols = Math.ceil(Math.sqrt(gridCount * (width / height)));
            const rows = Math.ceil(gridCount / cols);
            const cellW = width / cols;
            const cellH = height / rows;

            for (let i = 0; i < gridCount; i++) {
                const col = i % cols;
                const row = Math.floor(i / cols);
                const x = (col + 0.2 + Math.random() * 0.6) * cellW;
                const y = (row + 0.2 + Math.random() * 0.6) * cellH;
                const z = Math.random() * 0.8 + 0.4;
                nodes.push({
                    x, y, originX: x, originY: y,
                    vx: 0, vy: 0, z,
                    size: (2 + Math.random() * 2) * z,
                    pulsePhase: Math.random() * Math.PI * 2,
                    connections: [],
                });
            }

            const randomCount = nodeCount - gridCount;
            for (let i = 0; i < randomCount; i++) {
                const x = Math.random() * width;
                const y = Math.random() * height;
                const z = Math.random() * 0.8 + 0.4;
                nodes.push({
                    x, y, originX: x, originY: y,
                    vx: 0, vy: 0, z,
                    size: (2 + Math.random() * 2) * z,
                    pulsePhase: Math.random() * Math.PI * 2,
                    connections: [],
                });
            }
            nodes.sort((a, b) => a.z - b.z);
            updateConnections();
            initMicroParticles();
        };

        initNodesWithGrid();

        // Drawing function for one frame
        const drawFrame = (isAnimated: boolean, frameCount: number = 0) => {
            ctx.clearRect(0, 0, width, height);

            const centerX = width / 2;
            const centerY = height / 2;
            const mouseOffsetX = (mouseX - centerX) / centerX;
            const mouseOffsetY = (mouseY - centerY) / centerY;

            const getParallaxOffset = (z: number) => ({
                x: isAnimated ? mouseOffsetX * parallaxStrength * (z - 0.5) : 0,
                y: isAnimated ? mouseOffsetY * parallaxStrength * (z - 0.5) : 0,
            });

            if (isAnimated && frameCount % 60 === 0) {
                updateConnections();
            }

            if (isAnimated && Math.random() < 0.02) {
                const nodeIdx = Math.floor(Math.random() * nodes.length);
                const node = nodes[nodeIdx];
                if (node.connections.length > 0) {
                    const targetIdx = node.connections[Math.floor(Math.random() * node.connections.length)];
                    if (pulses.length <= 20) {
                        pulses.push({
                            fromNode: nodeIdx, toNode: targetIdx,
                            progress: 0, speed: 0.008 + Math.random() * 0.012,
                            color: Math.random() > 0.3 ? primaryColor : secondaryColor,
                        });
                    }
                }
            }

            ctx.fillStyle = primaryColor;
            microParticles.forEach(p => {
                if (isAnimated) {
                    p.x += p.vx;
                    p.y += p.vy;
                    p.twinklePhase += 0.02;
                    if (p.x < 0) p.x = width;
                    if (p.x > width) p.x = 0;
                    if (p.y < 0) p.y = height;
                    if (p.y > height) p.y = 0;
                }
                const twinkle = isAnimated ? (Math.sin(p.twinklePhase) * 0.5 + 0.5) : 1;
                const alpha = p.alpha * (0.5 + twinkle * 0.5);
                if (alpha < 0.05) return;
                ctx.globalAlpha = alpha;
                ctx.fillRect(p.x, p.y, p.size, p.size);
            });
            ctx.globalAlpha = 1.0;

            if (isAnimated) {
                nodes.forEach((node) => {
                    node.vx += (node.originX - node.x) * returnForce * node.z;
                    node.vy += (node.originY - node.y) * returnForce * node.z;
                    node.vx *= friction;
                    node.vy *= friction;
                    node.x += node.vx;
                    node.y += node.vy;
                    node.pulsePhase += 0.03;
                });
            }

            ctx.lineWidth = 1;
            nodes.forEach((node) => {
                const nodeOffset = getParallaxOffset(node.z);
                node.connections.forEach(j => {
                    const other = nodes[j];
                    const otherOffset = getParallaxOffset(other.z);
                    const nodeDrawX = node.x + nodeOffset.x;
                    const nodeDrawY = node.y + nodeOffset.y;
                    const otherDrawX = other.x + otherOffset.x;
                    const otherDrawY = other.y + otherOffset.y;
                    const dx = other.x - node.x;
                    const dy = other.y - node.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const maxDist = connectionDistance * Math.max(node.z, other.z);

                    if (dist < maxDist) {
                        const distFactor = 1 - (dist / maxDist);
                        const depthFactor = (node.z + other.z) / 2;
                        const alpha = distFactor * 0.2 * depthFactor;
                        if (alpha > 0.04) {
                            ctx.beginPath();
                            ctx.moveTo(nodeDrawX, nodeDrawY);
                            ctx.lineTo(otherDrawX, otherDrawY);
                            ctx.strokeStyle = `rgba(0, 242, 255, ${alpha.toFixed(3)})`;
                            ctx.stroke();
                        }
                    }
                });
            });

            if (isAnimated) {
                pulses = pulses.filter(pulse => {
                    pulse.progress += pulse.speed;
                    if (pulse.progress >= 1) return false;
                    const fromNode = nodes[pulse.fromNode];
                    const toNode = nodes[pulse.toNode];
                    if (!fromNode || !toNode) return false;
                    const x = fromNode.x + (toNode.x - fromNode.x) * pulse.progress;
                    const y = fromNode.y + (toNode.y - fromNode.y) * pulse.progress;
                    const offset = getParallaxOffset(fromNode.z);
                    ctx.fillStyle = '#ffffff';
                    ctx.beginPath();
                    ctx.arc(x + offset.x, y + offset.y, 2, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.fillStyle = pulse.color;
                    ctx.globalAlpha = 0.5;
                    ctx.beginPath();
                    ctx.arc(x + offset.x, y + offset.y, 4, 0, Math.PI * 2);
                    ctx.fill();
                    ctx.globalAlpha = 1.0;
                    return true;
                });
            }

            nodes.forEach((node) => {
                const offset = getParallaxOffset(node.z);
                const drawX = node.x + offset.x;
                const drawY = node.y + offset.y;

                let mouseProximity = 0;
                if (isAnimated) {
                    const dx = mouseX - drawX;
                    const dy = mouseY - drawY;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    mouseProximity = Math.max(0, 1 - dist / mouseRadius);
                }

                let alpha = 0.3 + node.z * 0.4;
                alpha += mouseProximity * 0.5;
                const size = node.size * (1 + mouseProximity * 0.5);

                if (mouseProximity > 0.2 && isAnimated) {
                    ctx.fillStyle = primaryColor;
                    ctx.globalAlpha = alpha * 0.3;
                    ctx.beginPath();
                    ctx.arc(drawX, drawY, size * 2.5, 0, Math.PI * 2);
                    ctx.fill();
                }

                ctx.fillStyle = primaryColor;
                ctx.globalAlpha = alpha;
                ctx.beginPath();
                ctx.arc(drawX, drawY, size, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = '#ffffff';
                ctx.globalAlpha = alpha * 0.8;
                ctx.beginPath();
                ctx.arc(drawX, drawY, size * 0.4, 0, Math.PI * 2);
                ctx.fill();

                ctx.globalAlpha = 1.0;
            });
        };

        if (animated) {
            let animationFrameId: number = 0;
            let frameCount = 0;

            const handleMouseMove = (e: MouseEvent) => {
                mouseX = e.clientX;
                mouseY = e.clientY;
            };

            const animate = () => {
                frameCount++;
                drawFrame(true, frameCount);
                animationFrameId = requestAnimationFrame(animate);
            };

            const handleResize = () => {
                updateCanvasSize();
                initNodesWithGrid();
            };

            window.addEventListener('mousemove', handleMouseMove);
            window.addEventListener('resize', handleResize);
            animate();

            return () => {
                window.removeEventListener('mousemove', handleMouseMove);
                window.removeEventListener('resize', handleResize);
                cancelAnimationFrame(animationFrameId);
            };
        } else {
            // Static render - drawn once
            drawFrame(false);

            const handleResize = () => {
                updateCanvasSize();
                initNodesWithGrid();
                drawFrame(false);
            };
            window.addEventListener('resize', handleResize);
            return () => window.removeEventListener('resize', handleResize);
        }
    }, [nodeCount, connectionDistance, mouseRadius, primaryColor, secondaryColor, animated]);

    return (
        <canvas
            ref={canvasRef}
            style={{
                display: 'block',
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                zIndex: 0,
            }}
        />
    );
};
