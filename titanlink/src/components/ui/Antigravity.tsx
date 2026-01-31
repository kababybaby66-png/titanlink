
import React, { useEffect, useRef } from 'react';

interface AntigravityProps {
    count?: number;
    magnetRadius?: number;
    particleSize?: number;
    color?: string;
}

export const Antigravity: React.FC<AntigravityProps> = ({
    count = 450,
    magnetRadius = 300,
    particleSize = 3,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        let width = canvas.width = window.innerWidth;
        let height = canvas.height = window.innerHeight;

        const colors = ['#00f2ff', '#ffffff', '#4abdff', '#0099ff'];

        const friction = 0.94; // Slide a bit more
        const ease = 0.01;     // Very weak spring -> No bounce, just drift home

        let particles: {
            x: number;
            y: number;
            z: number;
            originX: number;
            originY: number;
            vx: number;
            vy: number;
            color: string;
            size: number;
            width: number;
            angle: number; // Smoothed angle state
        }[] = [];

        const initParticles = () => {
            particles = [];
            for (let i = 0; i < count; i++) {
                const x = Math.random() * width;
                const y = Math.random() * height;
                const z = Math.random() * 1.5 + 0.5;

                particles.push({
                    x: x,
                    y: y,
                    z: z,
                    originX: x,
                    originY: y,
                    vx: 0,
                    vy: 0,
                    color: colors[Math.floor(Math.random() * colors.length)],
                    size: (Math.random() * 10 + 5) * z,
                    width: (Math.random() * 2 + 1) * z,
                    angle: 0 // Initial angle
                });
            }
            particles.sort((a, b) => a.z - b.z);
        };

        initParticles();

        let mouseX = -1000;
        let mouseY = -1000;

        const handleMouseMove = (e: MouseEvent) => {
            mouseX = e.clientX;
            mouseY = e.clientY;
        };

        const handleResize = () => {
            width = canvas.width = window.innerWidth;
            height = canvas.height = window.innerHeight;
            initParticles();
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('resize', handleResize);

        let animationFrameId: number;

        // Angle interpolation helper
        const lerpAngle = (start: number, end: number, amt: number) => {
            const difference = end - start;
            // Shortest path around circle
            const shortestAngle = ((((difference % (Math.PI * 2)) + (Math.PI * 3)) % (Math.PI * 2)) - Math.PI);
            return start + shortestAngle * amt;
        };

        const animate = () => {
            ctx.clearRect(0, 0, width, height);

            particles.forEach(p => {
                const dx = mouseX - p.x;
                const dy = mouseY - p.y;
                // Add tiny epsilon to correct div/0 or singularity
                const dist = Math.sqrt(dx * dx + dy * dy) + 0.1;

                if (dist < magnetRadius) {
                    const angle = Math.atan2(dy, dx);
                    const force = (magnetRadius - dist) / magnetRadius;
                    const moveForce = force * 0.6 * p.z;

                    p.vx += Math.cos(angle) * moveForce;
                    p.vy += Math.sin(angle) * moveForce;
                }

                const homeDx = p.originX - p.x;
                const homeDy = p.originY - p.y;
                p.vx += homeDx * ease * p.z;
                p.vy += homeDy * ease * p.z;

                p.vx *= friction;
                p.vy *= friction;
                p.x += p.vx;
                p.y += p.vy;

                // Opacity with Void Center
                let alpha = 0;
                const visibilityRadius = 400;
                const voidRadius = 140; // Invisible center radius

                if (dist > voidRadius && dist < visibilityRadius) {
                    // Opacity Logic:
                    // 1. Brightest right near the void
                    // 2. Fades out as you go further

                    const range = visibilityRadius - voidRadius;
                    const relativeDist = dist - voidRadius;

                    // Linear Fade Out (starts at 1.0)
                    let fadeOut = 1 - (relativeDist / range);

                    // Quick soft entry (0 to 1 in 20px)
                    const fadeIn = Math.min(1, relativeDist / 20);

                    alpha = fadeOut * fadeIn;
                    alpha = Math.pow(alpha, 1.2);
                }

                const depthAlphaFactor = Math.min(1, p.z * 0.6 + 0.2);
                alpha *= depthAlphaFactor;

                if (alpha > 0.05) {
                    // Target Rotation Logic: ALWAYS aim at the mouse
                    // This creates the "Iron Man" / "Focus" effect requested
                    const targetAngle = Math.atan2(dy, dx);

                    // Smoothly interpolate angle to prevent snapping
                    p.angle = lerpAngle(p.angle, targetAngle, 0.02);

                    // Enhanced brightness based on mouse proximity
                    // Particles glow brighter when close to cursor
                    const proximityBoost = Math.max(0, 1 - (dist / 350));
                    const glowIntensity = 0.3 + proximityBoost * 0.7; // 0.3 to 1.0 range

                    // Scale factor - particles grow slightly when near cursor
                    const scaleBoost = 1 + proximityBoost * 0.4;

                    ctx.save();
                    ctx.translate(p.x, p.y);
                    ctx.rotate(p.angle);

                    const r = (p.width / 2) * scaleBoost;
                    const w = p.size * scaleBoost;

                    // Create gradient for textured appearance
                    const gradient = ctx.createLinearGradient(-w / 2, 0, w / 2, 0);

                    // Parse color and apply intensity
                    const baseColor = p.color;
                    const intensifiedAlpha = alpha * glowIntensity;

                    // Core is brighter, edges fade
                    gradient.addColorStop(0, `rgba(255, 255, 255, ${intensifiedAlpha * 0.1})`);
                    gradient.addColorStop(0.3, baseColor.replace(')', `, ${intensifiedAlpha})`).replace('rgb', 'rgba'));
                    gradient.addColorStop(0.7, baseColor.replace(')', `, ${intensifiedAlpha})`).replace('rgb', 'rgba'));
                    gradient.addColorStop(1, `rgba(255, 255, 255, ${intensifiedAlpha * 0.1})`);

                    // Outer glow layer (if close to cursor)
                    if (proximityBoost > 0.2) {
                        ctx.globalAlpha = alpha * proximityBoost * 0.3;
                        ctx.shadowColor = p.color;
                        ctx.shadowBlur = 8 + proximityBoost * 12;

                        ctx.beginPath();
                        ctx.moveTo(-w / 2 + r, -r);
                        ctx.lineTo(w / 2 - r, -r);
                        ctx.arc(w / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2);
                        ctx.lineTo(-w / 2 + r, r);
                        ctx.arc(-w / 2 + r, 0, r, Math.PI / 2, -Math.PI / 2);
                        ctx.closePath();
                        ctx.fill();

                        ctx.shadowBlur = 0;
                    }

                    // Main particle body with gradient texture
                    ctx.globalAlpha = alpha * glowIntensity;
                    ctx.fillStyle = gradient;

                    ctx.beginPath();
                    ctx.moveTo(-w / 2 + r, -r);
                    ctx.lineTo(w / 2 - r, -r);
                    ctx.arc(w / 2 - r, 0, r, -Math.PI / 2, Math.PI / 2);
                    ctx.lineTo(-w / 2 + r, r);
                    ctx.arc(-w / 2 + r, 0, r, Math.PI / 2, -Math.PI / 2);
                    ctx.closePath();

                    ctx.fill();
                    ctx.restore();
                }
            });

            ctx.globalAlpha = 1.0;
            animationFrameId = requestAnimationFrame(animate);
        };

        animate();

        return () => {
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('resize', handleResize);
            cancelAnimationFrame(animationFrameId);
        };
    }, [count, magnetRadius, particleSize]);

    return <canvas ref={canvasRef} style={{ display: 'block', position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 0 }} />;
};
