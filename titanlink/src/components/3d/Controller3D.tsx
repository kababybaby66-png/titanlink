/**
 * Controller3D - Schematic 3D Controller with Reactive Inputs
 * TitanLink Cyber-Futuristic Style
 */

import { useRef, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { GamepadInputState } from '../../../shared/types/ipc';
import { isButtonPressed, XBOX_BUTTONS } from '../../../shared/types/ipc';

interface Controller3DProps {
    input: GamepadInputState | null;
    connected: boolean;
}

// Color palette matching TitanLink theme
const COLORS = {
    body: '#0a0a0c',
    bodyEdge: '#00f2ff',
    button: '#1a1a1e',
    buttonActive: '#00f2ff',
    buttonA: '#22ff88',
    buttonB: '#ff4455',
    buttonX: '#4488ff',
    buttonY: '#ffaa00',
    dpad: '#151518',
    stick: '#222226',
    stickHead: '#333338',
    trigger: '#181820',
    bumper: '#1a1a1e',
    glow: '#00f2ff',
    disconnected: '#ffb300',
};

// Helper: Create glowing edge material
function createEdgeMaterial(color: string, intensity: number = 1) {
    return new THREE.LineBasicMaterial({
        color: new THREE.Color(color),
        transparent: true,
        opacity: 0.6 * intensity,
    });
}

// Button Component
function Button3D({
    position,
    pressed,
    color,
    label,
    size = 0.12
}: {
    position: [number, number, number];
    pressed: boolean;
    color: string;
    label?: string;
    size?: number;
}) {
    const meshRef = useRef<THREE.Mesh>(null);
    const targetY = pressed ? -0.02 : 0;
    const currentY = useRef(0);

    useFrame((_, delta) => {
        if (meshRef.current) {
            currentY.current = THREE.MathUtils.lerp(currentY.current, targetY, delta * 20);
            meshRef.current.position.y = position[1] + currentY.current;

            // Glow intensity
            const mat = meshRef.current.material as THREE.MeshStandardMaterial;
            const targetIntensity = pressed ? 2 : 0.3;
            mat.emissiveIntensity = THREE.MathUtils.lerp(mat.emissiveIntensity, targetIntensity, delta * 15);
        }
    });

    return (
        <mesh ref={meshRef} position={position}>
            <cylinderGeometry args={[size, size, 0.04, 16]} />
            <meshStandardMaterial
                color={pressed ? color : COLORS.button}
                emissive={color}
                emissiveIntensity={pressed ? 2 : 0.3}
                metalness={0.8}
                roughness={0.3}
            />
        </mesh>
    );
}

// Analog Stick Component
function AnalogStick({
    position,
    stickX,
    stickY,
    clicked
}: {
    position: [number, number, number];
    stickX: number;
    stickY: number;
    clicked: boolean;
}) {
    const groupRef = useRef<THREE.Group>(null);
    const headRef = useRef<THREE.Mesh>(null);
    const currentTilt = useRef({ x: 0, z: 0 });
    const currentPush = useRef(0);

    useFrame((_, delta) => {
        if (groupRef.current && headRef.current) {
            // Smooth tilt towards input direction
            const maxTilt = 0.25; // radians
            const targetTiltX = -stickY * maxTilt; // Forward/back
            const targetTiltZ = stickX * maxTilt;  // Left/right

            currentTilt.current.x = THREE.MathUtils.lerp(currentTilt.current.x, targetTiltX, delta * 12);
            currentTilt.current.z = THREE.MathUtils.lerp(currentTilt.current.z, targetTiltZ, delta * 12);

            groupRef.current.rotation.x = currentTilt.current.x;
            groupRef.current.rotation.z = currentTilt.current.z;

            // Stick click depression
            const targetPush = clicked ? -0.03 : 0;
            currentPush.current = THREE.MathUtils.lerp(currentPush.current, targetPush, delta * 20);
            headRef.current.position.y = 0.06 + currentPush.current;

            // Glow on activity
            const activity = Math.sqrt(stickX * stickX + stickY * stickY);
            const mat = headRef.current.material as THREE.MeshStandardMaterial;
            mat.emissiveIntensity = THREE.MathUtils.lerp(mat.emissiveIntensity, clicked ? 1.5 : activity * 0.8, delta * 10);
        }
    });

    return (
        <group position={position}>
            {/* Base ring */}
            <mesh rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.14, 0.015, 8, 24]} />
                <meshStandardMaterial color={COLORS.body} emissive={COLORS.glow} emissiveIntensity={0.2} />
            </mesh>

            {/* Stick shaft + head group (tilts) */}
            <group ref={groupRef}>
                {/* Shaft */}
                <mesh>
                    <cylinderGeometry args={[0.03, 0.04, 0.08, 8]} />
                    <meshStandardMaterial color={COLORS.stick} metalness={0.9} roughness={0.4} />
                </mesh>

                {/* Head (concave top) */}
                <mesh ref={headRef} position={[0, 0.06, 0]}>
                    <sphereGeometry args={[0.08, 16, 12, 0, Math.PI * 2, 0, Math.PI / 2]} />
                    <meshStandardMaterial
                        color={clicked ? COLORS.buttonActive : COLORS.stickHead}
                        emissive={COLORS.glow}
                        emissiveIntensity={0.2}
                        metalness={0.7}
                        roughness={0.4}
                    />
                </mesh>

                {/* Grip texture rings on head */}
                <mesh position={[0, 0.08, 0]} rotation={[Math.PI / 2, 0, 0]}>
                    <torusGeometry args={[0.06, 0.008, 4, 16]} />
                    <meshStandardMaterial color="#111" metalness={0.9} roughness={0.6} />
                </mesh>
            </group>
        </group>
    );
}

// D-Pad Component
function DPad({
    position,
    up, down, left, right
}: {
    position: [number, number, number];
    up: boolean; down: boolean; left: boolean; right: boolean;
}) {
    const createButton = (pos: [number, number, number], active: boolean) => {
        const meshRef = useRef<THREE.Mesh>(null);

        useFrame((_, delta) => {
            if (meshRef.current) {
                const mat = meshRef.current.material as THREE.MeshStandardMaterial;
                mat.emissiveIntensity = THREE.MathUtils.lerp(mat.emissiveIntensity, active ? 1.5 : 0.1, delta * 15);
                meshRef.current.position.y = THREE.MathUtils.lerp(meshRef.current.position.y, active ? pos[1] - 0.01 : pos[1], delta * 20);
            }
        });

        return (
            <mesh ref={meshRef} position={pos}>
                <boxGeometry args={[0.06, 0.02, 0.06]} />
                <meshStandardMaterial
                    color={active ? COLORS.buttonActive : COLORS.dpad}
                    emissive={COLORS.glow}
                    emissiveIntensity={0.1}
                    metalness={0.8}
                    roughness={0.4}
                />
            </mesh>
        );
    };

    return (
        <group position={position}>
            {/* Base circle */}
            <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
                <cylinderGeometry args={[0.12, 0.12, 0.01, 24]} />
                <meshStandardMaterial color={COLORS.body} metalness={0.9} roughness={0.3} />
            </mesh>

            {/* D-Pad buttons */}
            {createButton([0, 0.01, -0.06], up)}      {/* Up */}
            {createButton([0, 0.01, 0.06], down)}     {/* Down */}
            {createButton([-0.06, 0.01, 0], left)}    {/* Left */}
            {createButton([0.06, 0.01, 0], right)}    {/* Right */}

            {/* Center hub */}
            <mesh position={[0, 0.01, 0]}>
                <cylinderGeometry args={[0.03, 0.03, 0.025, 8]} />
                <meshStandardMaterial color={COLORS.body} metalness={0.9} roughness={0.4} />
            </mesh>
        </group>
    );
}

// Trigger Component
function Trigger({
    position,
    value,
    side
}: {
    position: [number, number, number];
    value: number;
    side: 'left' | 'right';
}) {
    const meshRef = useRef<THREE.Mesh>(null);
    const currentRot = useRef(0);

    useFrame((_, delta) => {
        if (meshRef.current) {
            // Rotate trigger based on pull value
            const maxRot = 0.4; // radians
            const targetRot = value * maxRot;
            currentRot.current = THREE.MathUtils.lerp(currentRot.current, targetRot, delta * 15);
            meshRef.current.rotation.x = currentRot.current;

            // Glow
            const mat = meshRef.current.material as THREE.MeshStandardMaterial;
            mat.emissiveIntensity = THREE.MathUtils.lerp(mat.emissiveIntensity, value * 1.5, delta * 10);
        }
    });

    return (
        <mesh ref={meshRef} position={position}>
            <boxGeometry args={[0.18, 0.03, 0.1]} />
            <meshStandardMaterial
                color={COLORS.trigger}
                emissive={COLORS.glow}
                emissiveIntensity={0}
                metalness={0.8}
                roughness={0.4}
            />
        </mesh>
    );
}

// Bumper Component
function Bumper({
    position,
    pressed,
    side
}: {
    position: [number, number, number];
    pressed: boolean;
    side: 'left' | 'right';
}) {
    const meshRef = useRef<THREE.Mesh>(null);
    const currentPush = useRef(0);

    useFrame((_, delta) => {
        if (meshRef.current) {
            const targetPush = pressed ? -0.01 : 0;
            currentPush.current = THREE.MathUtils.lerp(currentPush.current, targetPush, delta * 20);
            meshRef.current.position.y = position[1] + currentPush.current;

            const mat = meshRef.current.material as THREE.MeshStandardMaterial;
            mat.emissiveIntensity = THREE.MathUtils.lerp(mat.emissiveIntensity, pressed ? 1.5 : 0.1, delta * 15);
        }
    });

    return (
        <mesh ref={meshRef} position={position}>
            <boxGeometry args={[0.2, 0.025, 0.08]} />
            <meshStandardMaterial
                color={pressed ? COLORS.buttonActive : COLORS.bumper}
                emissive={COLORS.glow}
                emissiveIntensity={0.1}
                metalness={0.8}
                roughness={0.4}
            />
        </mesh>
    );
}

// Center Buttons (Start, Back, Guide)
function CenterButtons({
    start, back, guide
}: {
    start: boolean; back: boolean; guide: boolean;
}) {
    return (
        <group position={[0, 0.06, 0.05]}>
            {/* Back button */}
            <Button3D position={[-0.15, 0, 0]} pressed={back} color={COLORS.glow} size={0.04} />

            {/* Guide button (center, larger) */}
            <mesh position={[0, 0, 0]}>
                <cylinderGeometry args={[0.06, 0.06, 0.02, 16]} />
                <meshStandardMaterial
                    color={guide ? COLORS.buttonActive : COLORS.body}
                    emissive={COLORS.glow}
                    emissiveIntensity={guide ? 2 : 0.3}
                    metalness={0.8}
                    roughness={0.3}
                />
            </mesh>
            {/* Guide ring */}
            <mesh position={[0, 0.01, 0]} rotation={[Math.PI / 2, 0, 0]}>
                <torusGeometry args={[0.07, 0.008, 8, 24]} />
                <meshStandardMaterial color={COLORS.glow} emissive={COLORS.glow} emissiveIntensity={guide ? 2 : 0.5} />
            </mesh>

            {/* Start button */}
            <Button3D position={[0.15, 0, 0]} pressed={start} color={COLORS.glow} size={0.04} />
        </group>
    );
}

// Main Controller Body
function ControllerBody() {
    const bodyRef = useRef<THREE.Group>(null);

    // Idle floating animation
    useFrame((state) => {
        if (bodyRef.current) {
            bodyRef.current.position.y = Math.sin(state.clock.elapsedTime * 0.8) * 0.015;
            bodyRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.5) * 0.02;
        }
    });

    return (
        <group ref={bodyRef}>
            {/* Main body - rounded rectangle shape */}
            <mesh>
                <boxGeometry args={[1.0, 0.08, 0.5]} />
                <meshStandardMaterial
                    color={COLORS.body}
                    metalness={0.9}
                    roughness={0.3}
                />
            </mesh>

            {/* Left grip */}
            <mesh position={[-0.42, -0.02, 0.12]} rotation={[0.2, 0.2, 0]}>
                <boxGeometry args={[0.18, 0.12, 0.25]} />
                <meshStandardMaterial color={COLORS.body} metalness={0.9} roughness={0.3} />
            </mesh>

            {/* Right grip */}
            <mesh position={[0.42, -0.02, 0.12]} rotation={[0.2, -0.2, 0]}>
                <boxGeometry args={[0.18, 0.12, 0.25]} />
                <meshStandardMaterial color={COLORS.body} metalness={0.9} roughness={0.3} />
            </mesh>

            {/* Edge glow lines */}
            <lineSegments position={[0, 0.041, 0]}>
                <edgesGeometry args={[new THREE.BoxGeometry(1.0, 0.001, 0.5)]} />
                <lineBasicMaterial color={COLORS.bodyEdge} transparent opacity={0.6} />
            </lineSegments>

            {/* Accent lines on body */}
            <mesh position={[0, 0.041, 0.15]} rotation={[0, 0, 0]}>
                <boxGeometry args={[0.6, 0.002, 0.01]} />
                <meshStandardMaterial color={COLORS.glow} emissive={COLORS.glow} emissiveIntensity={1} />
            </mesh>
            <mesh position={[0, 0.041, -0.15]} rotation={[0, 0, 0]}>
                <boxGeometry args={[0.6, 0.002, 0.01]} />
                <meshStandardMaterial color={COLORS.glow} emissive={COLORS.glow} emissiveIntensity={1} />
            </mesh>
        </group>
    );
}

// Disconnected State Animation
function DisconnectedOverlay() {
    const meshRef = useRef<THREE.Mesh>(null);

    useFrame((state) => {
        if (meshRef.current) {
            const mat = meshRef.current.material as THREE.MeshStandardMaterial;
            mat.opacity = 0.3 + Math.sin(state.clock.elapsedTime * 2) * 0.2;
        }
    });

    return (
        <mesh ref={meshRef} position={[0, 0.1, 0]}>
            <ringGeometry args={[0.15, 0.2, 32]} />
            <meshStandardMaterial
                color={COLORS.disconnected}
                emissive={COLORS.disconnected}
                emissiveIntensity={1}
                transparent
                opacity={0.5}
                side={THREE.DoubleSide}
            />
        </mesh>
    );
}

// Main Controller3D Component
export function Controller3D({ input, connected }: Controller3DProps) {
    // Default state when no input
    const defaultInput = useMemo(() => ({
        buttons: 0,
        leftStickX: 0,
        leftStickY: 0,
        rightStickX: 0,
        rightStickY: 0,
        leftTrigger: 0,
        rightTrigger: 0,
        timestamp: 0,
    }), []);

    const state = input || defaultInput;

    // Parse button states
    const buttonA = isButtonPressed(state.buttons, 'A');
    const buttonB = isButtonPressed(state.buttons, 'B');
    const buttonX = isButtonPressed(state.buttons, 'X');
    const buttonY = isButtonPressed(state.buttons, 'Y');
    const buttonLB = isButtonPressed(state.buttons, 'LB');
    const buttonRB = isButtonPressed(state.buttons, 'RB');
    const buttonBack = isButtonPressed(state.buttons, 'BACK');
    const buttonStart = isButtonPressed(state.buttons, 'START');
    const buttonLS = isButtonPressed(state.buttons, 'LEFT_STICK');
    const buttonRS = isButtonPressed(state.buttons, 'RIGHT_STICK');
    const dpadUp = isButtonPressed(state.buttons, 'DPAD_UP');
    const dpadDown = isButtonPressed(state.buttons, 'DPAD_DOWN');
    const dpadLeft = isButtonPressed(state.buttons, 'DPAD_LEFT');
    const dpadRight = isButtonPressed(state.buttons, 'DPAD_RIGHT');
    const buttonGuide = isButtonPressed(state.buttons, 'GUIDE');

    return (
        <group position={[0, -0.3, 0]} rotation={[0.4, 0, 0]} scale={[2.2, 2.2, 2.2]}>
            {/* Controller Body */}
            <ControllerBody />

            {/* Left Analog Stick */}
            <AnalogStick
                position={[-0.25, 0.04, -0.08]}
                stickX={state.leftStickX}
                stickY={state.leftStickY}
                clicked={buttonLS}
            />

            {/* Right Analog Stick */}
            <AnalogStick
                position={[0.15, 0.04, 0.08]}
                stickX={state.rightStickX}
                stickY={state.rightStickY}
                clicked={buttonRS}
            />

            {/* Face Buttons (ABXY) */}
            <group position={[0.32, 0.04, -0.08]}>
                <Button3D position={[0, 0, 0.08]} pressed={buttonA} color={COLORS.buttonA} />
                <Button3D position={[0.08, 0, 0]} pressed={buttonB} color={COLORS.buttonB} />
                <Button3D position={[-0.08, 0, 0]} pressed={buttonX} color={COLORS.buttonX} />
                <Button3D position={[0, 0, -0.08]} pressed={buttonY} color={COLORS.buttonY} />
            </group>

            {/* D-Pad */}
            <DPad
                position={[-0.15, 0.04, 0.08]}
                up={dpadUp}
                down={dpadDown}
                left={dpadLeft}
                right={dpadRight}
            />

            {/* Triggers */}
            <Trigger position={[-0.35, 0.06, -0.28]} value={state.leftTrigger} side="left" />
            <Trigger position={[0.35, 0.06, -0.28]} value={state.rightTrigger} side="right" />

            {/* Bumpers */}
            <Bumper position={[-0.28, 0.05, -0.22]} pressed={buttonLB} side="left" />
            <Bumper position={[0.28, 0.05, -0.22]} pressed={buttonRB} side="right" />

            {/* Center Buttons */}
            <CenterButtons start={buttonStart} back={buttonBack} guide={buttonGuide} />

            {/* Disconnected overlay */}
            {!connected && <DisconnectedOverlay />}
        </group>
    );
}

export default Controller3D;
