import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { Edges } from '@react-three/drei'
import * as THREE from 'three'

export const SchematicCube = () => {
    const meshRef = useRef<THREE.Mesh>(null)

    useFrame((state) => {
        if (meshRef.current) {
            meshRef.current.rotation.x = Math.sin(state.clock.elapsedTime * 0.5) * 0.2
            meshRef.current.rotation.y += 0.01
        }
    })

    return (
        <mesh ref={meshRef}>
            <boxGeometry args={[1.5, 1.5, 1.5]} />
            <meshStandardMaterial
                color="#050b0c"
                transparent
                opacity={0.9}
            />
            <Edges
                scale={1}
                threshold={15}
                color="#00f2ff"
            />
        </mesh>
    )
}
