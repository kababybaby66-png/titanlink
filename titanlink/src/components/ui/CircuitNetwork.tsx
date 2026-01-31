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

// Micro particles for filling empty spaces
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
    nodeCount = 120,
    connectionDistance = 220,
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
        const parallaxStrength = 30; // Max pixel shift for 3D parallax effect

        let nodes: Node[] = [];
        let pulses: DataPulse[] = [];
        let microParticles: MicroParticle[] = [];
        let mouseX = -1000;
        let mouseY = -1000;

        // Initialize micro particles (dust/fill)
        const initMicroParticles = () => {
            microParticles = [];
            const microCount = Math.floor(width * height / 8000); // Density based on screen size
            for (let i = 0; i < microCount; i++) {
                microParticles.push({
                    x: Math.random() * width,
                    y: Math.random() * height,
                    vx: (Math.random() - 0.5) * 0.3,
                    vy: (Math.random() - 0.5) * 0.3,
                    size: Math.random() * 1.5 + 0.5,
                    alpha: Math.random() * 0.3 + 0.1,
                    twinklePhase: Math.random() * Math.PI * 2,
                });
            }
        };

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

        // Ensure even distribution by using grid-based placement for some nodes
        const initNodesWithGrid = () => {
            nodes = [];

            // Grid-based nodes for even coverage (60% of nodes)
            const gridCount = Math.floor(nodeCount * 0.6);
            const cols = Math.ceil(Math.sqrt(gridCount * (width / height)));
            const rows = Math.ceil(gridCount / cols);
            const cellW = width / cols;
            const cellH = height / rows;

            for (let i = 0; i < gridCount; i++) {
                const col = i % cols;
                const row = Math.floor(i / cols);
                // Jitter within cell
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

            // Random nodes for organic feel (40% of nodes)
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

        initNodesWithGrid();

        const handleMouseMove = (e: MouseEvent) => {
            mouseX = e.clientX;
            mouseY = e.clientY;
        };

        const handleResize = () => {
            width = canvas.width = window.innerWidth;
            height = canvas.height = window.innerHeight;
            initNodesWithGrid();
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('resize', handleResize);

        let animationFrameId: number;
        let frameCount = 0;

        const animate = () => {
            ctx.clearRect(0, 0, width, height);
            frameCount++;

            // Calculate parallax offset based on mouse position relative to center
            // Objects with higher z (closer) shift more, creating 3D depth
            const centerX = width / 2;
            const centerY = height / 2;
            const mouseOffsetX = (mouseX - centerX) / centerX; // -1 to 1
            const mouseOffsetY = (mouseY - centerY) / centerY; // -1 to 1

            const getParallaxOffset = (z: number) => ({
                x: mouseOffsetX * parallaxStrength * (z - 0.5),
                y: mouseOffsetY * parallaxStrength * (z - 0.5),
            });

            // Update connections every 30 frames
            if (frameCount % 30 === 0) {
                updateConnections();
            }

            // Maybe spawn new pulses
            maybeSpawnPulse();

            // Update and draw micro particles (background dust)
            microParticles.forEach(p => {
                // Slow drift
                p.x += p.vx;
                p.y += p.vy;
                p.twinklePhase += 0.02;

                // Wrap around screen
                if (p.x < 0) p.x = width;
                if (p.x > width) p.x = 0;
                if (p.y < 0) p.y = height;
                if (p.y > height) p.y = 0;

                // Twinkle effect
                const twinkle = Math.sin(p.twinklePhase) * 0.5 + 0.5;
                const alpha = p.alpha * (0.5 + twinkle * 0.5);

                // Mouse proximity boost
                const dx = mouseX - p.x;
                const dy = mouseY - p.y;
                const dist = Math.sqrt(dx * dx + dy * dy);
                const mouseBoost = Math.max(0, 1 - dist / 300) * 0.4;

                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(0, 242, 255, ${alpha + mouseBoost})`;
                ctx.fill();
            });

            // Update and draw nodes
            nodes.forEach((node, i) => {
                // Mouse interaction (for glow effects, no repulsion)
                const dx = mouseX - node.x;
                const dy = mouseY - node.y;
                const dist = Math.sqrt(dx * dx + dy * dy);

                // Gentle drift back to origin (no repel - nodes stay in place)
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
                const nodeOffset = getParallaxOffset(node.z);

                node.connections.forEach(j => {
                    const other = nodes[j];
                    const otherOffset = getParallaxOffset(other.z);

                    // Apply parallax to positions
                    const nodeDrawX = node.x + nodeOffset.x;
                    const nodeDrawY = node.y + nodeOffset.y;
                    const otherDrawX = other.x + otherOffset.x;
                    const otherDrawY = other.y + otherOffset.y;

                    const dx = other.x - node.x;
                    const dy = other.y - node.y;
                    const dist = Math.sqrt(dx * dx + dy * dy);
                    const maxDist = connectionDistance * Math.max(node.z, other.z);

                    if (dist < maxDist) {
                        // Calculate proximity to mouse for glow effect
                        const midX = (nodeDrawX + otherDrawX) / 2;
                        const midY = (nodeDrawY + otherDrawY) / 2;
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
                            ctx.moveTo(nodeDrawX, nodeDrawY);
                            ctx.lineTo(otherDrawX, otherDrawY);

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
                // Get parallax offset for this node's depth
                const offset = getParallaxOffset(node.z);
                const drawX = node.x + offset.x;
                const drawY = node.y + offset.y;

                const dx = mouseX - drawX;
                const dy = mouseY - drawY;
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
                    const glowGradient = ctx.createRadialGradient(drawX, drawY, 0, drawX, drawY, glowSize);
                    glowGradient.addColorStop(0, `rgba(0, 242, 255, ${(mouseProximity * 0.3 + pulse * 0.1) * alpha})`);
                    glowGradient.addColorStop(0.5, `rgba(0, 242, 255, ${(mouseProximity * 0.1) * alpha})`);
                    glowGradient.addColorStop(1, 'transparent');

                    ctx.fillStyle = glowGradient;
                    ctx.fillRect(drawX - glowSize, drawY - glowSize, glowSize * 2, glowSize * 2);
                }

                // Node core
                ctx.beginPath();
                ctx.arc(drawX, drawY, size, 0, Math.PI * 2);

                // Gradient fill for depth
                const coreGradient = ctx.createRadialGradient(
                    drawX - size * 0.3, drawY - size * 0.3, 0,
                    drawX, drawY, size
                );
                coreGradient.addColorStop(0, `rgba(255, 255, 255, ${alpha})`);
                coreGradient.addColorStop(0.4, `rgba(0, 242, 255, ${alpha})`);
                coreGradient.addColorStop(1, `rgba(0, 150, 200, ${alpha * 0.5})`);

                ctx.fillStyle = coreGradient;
                ctx.fill();

                // Inner highlight (when active)
                if (mouseProximity > 0.3) {
                    ctx.beginPath();
                    ctx.arc(drawX, drawY, size * 0.4, 0, Math.PI * 2);
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
