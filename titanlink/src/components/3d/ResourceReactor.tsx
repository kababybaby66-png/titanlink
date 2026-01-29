
import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { Edges } from '@react-three/drei';

interface ResourceReactorProps {
    cpuUsage: number;
    memUsage: number;
}

export const ResourceReactor = ({ cpuUsage, memUsage }: ResourceReactorProps) => {
    const coreRef = useRef<THREE.Mesh>(null);
    const innerRingRef = useRef<THREE.Group>(null);
    const outerRingRef = useRef<THREE.Group>(null);

    // Smooth out the values for animation to prevent jitter
    const smoothedCpu = useRef(cpuUsage);
    const smoothedMem = useRef(memUsage);

    // Color interpolation
    const coreColor = useMemo(() => {
        const color = new THREE.Color();
        // Base cyan
        const cyan = new THREE.Color('#00f2ff');
        // Warning amber
        const amber = new THREE.Color('#ffb300');
        // Danger red
        const red = new THREE.Color('#ff2a2a');

        if (smoothedCpu.current < 50) {
            color.copy(cyan).lerp(amber, smoothedCpu.current / 50);
        } else {
            color.copy(amber).lerp(red, (smoothedCpu.current - 50) / 50);
        }
        return color;
    }, [cpuUsage]); // React to prop change, but we'll use lerped value in frame for smooth transitions usually, 
    // but for color direct prop mapping is okay or we can lerp in useFrame too.
    // For simplicity, let's keep color reactive to prop for now, maybe lerp in useFrame for advanced.

    useFrame((state, delta) => {
        // Smooth interpolation
        smoothedCpu.current = THREE.MathUtils.lerp(smoothedCpu.current, cpuUsage, delta * 2);
        smoothedMem.current = THREE.MathUtils.lerp(smoothedMem.current, memUsage, delta * 2);

        if (coreRef.current) {
            // Pulse breathing effect based on CPU
            const baseScale = 1;
            // Higher CPU = Faster and deeper pulse
            const pulseSpeed = 1 + (smoothedCpu.current / 100) * 4;
            const pulseIntensity = 0.1 + (smoothedCpu.current / 100) * 0.2;

            const scale = baseScale + Math.sin(state.clock.elapsedTime * pulseSpeed) * pulseIntensity;
            coreRef.current.scale.setScalar(scale);

            // Jitter/Vibrate at high load
            if (smoothedCpu.current > 80) {
                coreRef.current.position.x = (Math.random() - 0.5) * 0.05;
                coreRef.current.position.y = (Math.random() - 0.5) * 0.05;
                coreRef.current.position.z = (Math.random() - 0.5) * 0.05;
            } else {
                coreRef.current.position.set(0, 0, 0);
            }

            // Dynamic color update if we want smooth color transitions
            const targetColor = new THREE.Color();
            if (smoothedCpu.current < 50) {
                targetColor.set('#00f2ff').lerp(new THREE.Color('#ffb300'), smoothedCpu.current / 50);
            } else {
                targetColor.set('#ffb300').lerp(new THREE.Color('#ff2a2a'), (smoothedCpu.current - 50) / 50);
            }
            (coreRef.current.material as THREE.MeshStandardMaterial).color.lerp(targetColor, delta * 2);
            (coreRef.current.material as THREE.MeshStandardMaterial).emissive.lerp(targetColor, delta * 2);
        }

        // Inner Ring Animation (RAM)
        if (innerRingRef.current) {
            // RAM usage drives rotation speed
            const rotSpeed = 0.2 + (smoothedMem.current / 100) * 2;
            innerRingRef.current.rotation.x += delta * rotSpeed;
            innerRingRef.current.rotation.y += delta * rotSpeed * 0.5;
        }

        // Outer Ring Animation (Idle + Load)
        if (outerRingRef.current) {
            outerRingRef.current.rotation.z -= delta * 0.1;
            // Expand slightly on load
            const targetScale = 1 + (smoothedMem.current / 100) * 0.2;
            outerRingRef.current.scale.lerp(new THREE.Vector3(targetScale, targetScale, targetScale), delta);
        }
    });

    return (
        <group scale={[0.55, 0.55, 0.55]}>
            {/* Core Reactor Sphere (CPU) */}
            <mesh ref={coreRef}>
                <icosahedronGeometry args={[0.6, 1]} />
                <meshStandardMaterial
                    color="#00f2ff"
                    emissive="#00f2ff"
                    emissiveIntensity={2}
                    transparent
                    opacity={0.9}
                    flatShading
                />
            </mesh>

            {/* Inner Ring (RAM) - Vertical Rings */}
            <group ref={innerRingRef}>
                <mesh rotation={[0, 0, 0]}>
                    <torusGeometry args={[1.0, 0.02, 16, 100]} />
                    <meshStandardMaterial color="#00f2ff" emissive="#00f2ff" emissiveIntensity={1} />
                </mesh>
                <mesh rotation={[Math.PI / 2, 0, 0]}>
                    <torusGeometry args={[1.0, 0.02, 16, 100]} />
                    <meshStandardMaterial color="#00f2ff" emissive="#00f2ff" emissiveIntensity={1} />
                </mesh>
            </group>

            {/* Outer Shell/Cage */}
            <group ref={outerRingRef}>
                <mesh>
                    <dodecahedronGeometry args={[1.4, 0]} />
                    <meshStandardMaterial color="#ffffff" transparent opacity={0.05} wireframe />
                </mesh>
                <lineSegments>
                    <edgesGeometry args={[new THREE.DodecahedronGeometry(1.4, 0)]} />
                    <lineBasicMaterial color="#00f2ff" transparent opacity={0.3} />
                </lineSegments>
            </group>
        </group>
    );
};
