/**
 * CircuitNetwork - Cyberpunk neural network particle system
 * 
 * Features:
 * - Interconnected nodes with dynamic connections
 * - Data pulse animations along connection lines
 * - Mouse proximity effects (glow, pulse, attract)
 * - Depth layers for parallax effect
 */

import React, { useEffect, useRef } from 'react';

interface CircuitNetworkProps {
    nodeCount?: number;
    connectionDistance?: number;
    mouseRadius?: number;
    primaryColor?: string;
    secondaryColor?: string;
}

interface Node {
    x: number;
    y: number;
    originX: number;
    originY: number;
    vx: number;
    vy: number;
    z: number; // Depth layer
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

export const CircuitNetwork: React.FC<CircuitNetworkProps> = ({
    nodeCount = 80,
    connectionDistance = 180,
    mouseRadius = 250,
    primaryColor = '#00f2ff',
    secondaryColor = '#4abdff',
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let width = canvas.width = window.innerWidth;
        let height = canvas.height = window.innerHeight;

        // Configuration
        const friction = 0.92;
        const returnForce = 0.008;
        const repelForce = 0.4;

        let nodes: Node[] = [];
        let pulses: DataPulse[] = [];
        let mouseX = -1000;
        let mouseY = -1000;

        // Initialize nodes
        const initNodes = () => {
            nodes = [];
            for (let i = 0; i < nodeCount; i++) {
                const x = Math.random() * width;
                const y = Math.random() * height;
                const z = Math.random() * 0.8 + 0.4; // 0.4 to 1.2 depth

                nodes.push({
                    x,
                    y,
                    originX: x,
                    originY: y,
                    vx: 0,
                    vy: 0,
                    z,
                    size: (2 + Math.random() * 2) * z,
                    pulsePhase: Math.random() * Math.PI * 2,
                    connections: [],
                });
            }
            // Sort by depth for proper rendering
            nodes.sort((a, b) => a.z - b.z);

            // Precompute potential connections
            updateConnections();
        };

        // Update which nodes can connect
        const updateConnections = () => {
            nodes.forEach((node, i) => {
                node.connections = [];
                nodes.forEach((other, j) => {
                    if (i >= j) return; // Avoid duplicates
                    const dx = node.x - other.x;
                    const dy = node.y - other.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    if (dist < connectionDistance * Math.max(node.z, other.z)) {
                        node.connections.push(j);
                    }
                });
            });
        };

        // Spawn a data pulse between two nodes
        const spawnPulse = (fromIdx: number, toIdx: number) => {
            if (pulses.length > 50) return; // Limit pulses

            pulses.push({
                fromNode: fromIdx,
                toNode: toIdx,
                progress: 0,
                speed: 0.008 + Math.random() * 0.012,
                color: Math.random() > 0.3 ? primaryColor : secondaryColor,
            });
        };

        // Randomly spawn pulses
        const maybeSpawnPulse = () => {
            if (Math.random() < 0.02) { // 2% chance per frame
                const nodeIdx = Math.floor(Math.random() * nodes.length);
                const node = nodes[nodeIdx];
                if (node.connections.length > 0) {
                    const targetIdx = node.connections[Math.floor(Math.random() * node.connections.length)];
                    spawnPulse(nodeIdx, targetIdx);
                }
            }
        };

        initNodes();

        const handleMouseMove = (e: MouseEvent) => {
            mouseX = e.clientX;
            mouseY = e.clientY;
        };

        const handleResize = () => {
            width = canvas.width = window.innerWidth;
            height = canvas.height = window.innerHeight;
            initNodes();
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('resize', handleResize);

        let animationFrameId: number;
        let frameCount = 0;

        const animate = () => {
            ctx.clearRect(0, 0, width, height);
            frameCount++;

            // Update connections every 30 frames
            if (frameCount % 30 === 0) {
                updateConnections();
            }

            // Maybe spawn new pulses
            maybeSpawnPulse();

            // Update and draw nodes
            nodes.forEach((node, i) => {
                // Mouse interaction
                const dx = mouseX - node.x;
                const dy = mouseY - node.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                // Repel from mouse
                if (dist < mouseRadius) {
                    const force = (mouseRadius - dist) / mouseRadius;
                    const angle = Math.atan2(dy, dx);
                    node.vx -= Math.cos(angle) * force * repelForce * node.z;
                    node.vy -= Math.sin(angle) * force * repelForce * node.z;
                }

                // Return to origin
                node.vx += (node.originX - node.x) * returnForce * node.z;
                node.vy += (node.originY - node.y) * returnForce * node.z;

                // Apply friction
                node.vx *= friction;
                node.vy *= friction;

                // Update position
                node.x += node.vx;
                node.y += node.vy;

                // Update pulse phase
                node.pulsePhase += 0.03;
            });

            // Draw connections first (behind nodes)
            nodes.forEach((node, i) => {
                node.connections.forEach(j => {
                    const other = nodes[j];
                    const dx = other.x - node.x;
                    const dy = other.y - node.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const maxDist = connectionDistance * Math.max(node.z, other.z);

                    if (dist < maxDist) {
                        // Calculate proximity to mouse for glow effect
                        const midX = (node.x + other.x) / 2;
                        const midY = (node.y + other.y) / 2;
                        const mouseDist = Math.sqrt((mouseX - midX) ** 2 + (mouseY - midY) ** 2);
                        const mouseProximity = Math.max(0, 1 - mouseDist / (mouseRadius * 1.5));

                        // Line opacity based on distance and depth
                        const distFactor = 1 - (dist / maxDist);
                        const depthFactor = (node.z + other.z) / 2;
                        let alpha = distFactor * 0.15 * depthFactor;

                        // Boost when mouse is near
                        alpha += mouseProximity * 0.3;

                        if (alpha > 0.02) {
                            ctx.beginPath();
                            ctx.moveTo(node.x, node.y);
                            ctx.lineTo(other.x, other.y);

                            // Glow effect when mouse is near
                            if (mouseProximity > 0.2) {
                                ctx.shadowColor = primaryColor;
                                ctx.shadowBlur = 5 + mouseProximity * 10;
                            }

                            ctx.strokeStyle = `rgba(0, 242, 255, ${alpha})`;
                            ctx.lineWidth = 0.5 + mouseProximity * 1;
                            ctx.stroke();
                            ctx.shadowBlur = 0;
                        }
                    }
                });
            });

            // Draw data pulses
            pulses = pulses.filter(pulse => {
                pulse.progress += pulse.speed;
                if (pulse.progress >= 1) return false;

                const fromNode = nodes[pulse.fromNode];
                const toNode = nodes[pulse.toNode];
                if (!fromNode || !toNode) return false;

                const x = fromNode.x + (toNode.x - fromNode.x) * pulse.progress;
                const y = fromNode.y + (toNode.y - fromNode.y) * pulse.progress;

                // Draw pulse glow
                const gradient = ctx.createRadialGradient(x, y, 0, x, y, 8);
                gradient.addColorStop(0, pulse.color);
                gradient.addColorStop(0.5, `${pulse.color}88`);
                gradient.addColorStop(1, 'transparent');

                ctx.fillStyle = gradient;
                ctx.fillRect(x - 8, y - 8, 16, 16);

                // Draw pulse core
                ctx.beginPath();
                ctx.arc(x, y, 2, 0, Math.PI * 2);
                ctx.fillStyle = '#ffffff';
                ctx.fill();

                return true;
            });

            // Draw nodes (on top)
            nodes.forEach((node, i) => {
                const dx = mouseX - node.x;
                const dy = mouseY - node.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const mouseProximity = Math.max(0, 1 - dist / mouseRadius);

                // Pulsing effect
                const pulse = Math.sin(node.pulsePhase) * 0.5 + 0.5;

                // Base alpha from depth
                let alpha = 0.3 + node.z * 0.4;

                // Boost when mouse is near
                alpha += mouseProximity * 0.5;

                // Node size with pulse and proximity boost
                const size = node.size * (1 + pulse * 0.2 + mouseProximity * 0.5);

                // Outer glow
                if (mouseProximity > 0.2 || pulse > 0.7) {
                    const glowSize = size * 3;
                    const glowGradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, glowSize);
                    glowGradient.addColorStop(0, `rgba(0, 242, 255, ${(mouseProximity * 0.3 + pulse * 0.1) * alpha})`);
                    glowGradient.addColorStop(0.5, `rgba(0, 242, 255, ${(mouseProximity * 0.1) * alpha})`);
                    glowGradient.addColorStop(1, 'transparent');

                    ctx.fillStyle = glowGradient;
                    ctx.fillRect(node.x - glowSize, node.y - glowSize, glowSize * 2, glowSize * 2);
                }

                // Node core
                ctx.beginPath();
                ctx.arc(node.x, node.y, size, 0, Math.PI * 2);

                // Gradient fill for depth
                const coreGradient = ctx.createRadialGradient(
                    node.x - size * 0.3, node.y - size * 0.3, 0,
                    node.x, node.y, size
                );
                coreGradient.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
                coreGradient.addColorStop(0.4, `rgba(0, 242, 255, ${alpha})`);
                coreGradient.addColorStop(1, `rgba(0, 150, 200, ${alpha * 0.5})`);

                ctx.fillStyle = coreGradient;
                ctx.fill();

                // Inner highlight (when active)
                if (mouseProximity > 0.3) {
                    ctx.beginPath();
                    ctx.arc(node.x, node.y, size * 0.4, 0, Math.PI * 2);
                    ctx.fillStyle = `rgba(255, 255, 255, ${mouseProximity * 0.8})`;
                    ctx.fill();
                }
            });

            animationFrameId = requestAnimationFrame(animate);
        };

        animate();

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('resize', handleResize);
            cancelAnimationFrame(animationFrameId);
        };
    }, [nodeCount, connectionDistance, mouseRadius, primaryColor, secondaryColor]);

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
