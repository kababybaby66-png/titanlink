import { Canvas } from '@react-three/fiber'
import { OrbitControls, PerspectiveCamera } from '@react-three/drei'
import React from 'react'
import './HoloCanvas.css'

// Usage: <HoloCanvas><Your3DObject /></HoloCanvas>
export const HoloCanvas = ({ children }: { children: React.ReactNode }) => {
    return (
        <div className="holo-canvas-container">
            <Canvas gl={{ antialias: true, alpha: true }}>
                <PerspectiveCamera makeDefault position={[0, 0, 5]} />
                <ambientLight intensity={0.5} />
                <pointLight position={[10, 10, 10]} intensity={1} color="#00f2ff" />

                {children}

                <OrbitControls enableZoom={false} autoRotate autoRotateSpeed={0.5} />
            </Canvas>

            {/* Optional: CSS Overlay for scanlines matching global style */}
            <div className="holo-scanlines" />
        </div>
    )
}
