"use client";

import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState, useMemo } from "react";
import * as THREE from "three";
import type { RoundTarget } from "@/lib/game-types";

export interface ExplosionState {
  id: string;
  x: number;
  y: number;
  z: number;
  color: string;
  createdAt: number;
}

function CameraController() {
  const { camera, size } = useThree();
  
  useEffect(() => {
    const aspect = size.width / size.height;
    const distance = 8;
    const halfWidth = 3.6; // Slightly larger for padding (playfield is [-3.3, 3.3])
    
    if (camera instanceof THREE.PerspectiveCamera) {
      if (aspect < 1) {
        // Calculate FOV required to fit width for portrait mode
        const fovRad = 2 * Math.atan((halfWidth / aspect) / distance);
        camera.fov = fovRad * (180 / Math.PI);
      } else {
        camera.fov = 48; // Default landscape FOV
      }
      camera.updateProjectionMatrix();
    }
  }, [camera, size]);

  return null;
}

function BackgroundAtmosphere() {
  const gridRef = useRef<THREE.GridHelper>(null);
  
  useFrame(({ clock }) => {
    if (gridRef.current) {
      // Slowly drift the grid
      gridRef.current.position.y = (clock.elapsedTime * 0.15) % 1;
    }
  });
  
  return (
    <group rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -1.4]}>
      <gridHelper ref={gridRef} args={[30, 30, "#1e3a8a", "#0f172a"]} />
    </group>
  );
}

function ExplosionParticles({ explosion }: { explosion: ExplosionState }) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const count = 25;
  
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const particles = useMemo(() => {
    return Array.from({ length: count }, () => {
      // Distribute particles spherically
      const theta = Math.random() * 2 * Math.PI;
      const phi = Math.acos(2 * Math.random() - 1);
      const speed = 3 + Math.random() * 5;
      return {
        velocity: new THREE.Vector3(
          Math.sin(phi) * Math.cos(theta) * speed,
          Math.sin(phi) * Math.sin(theta) * speed,
          Math.cos(phi) * speed
        ),
        position: new THREE.Vector3(explosion.x, explosion.y, explosion.z),
        scale: Math.random() * 0.4 + 0.4
      };
    });
  }, [explosion]);

  const startTime = useRef<number>(0);
  const initialized = useRef(false);

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    if (!initialized.current) {
      startTime.current = clock.elapsedTime;
      initialized.current = true;
    }
    const age = clock.elapsedTime - startTime.current;
    const progress = Math.min(age / 0.4, 1);
    
    particles.forEach((p, i) => {
      p.position.addScaledVector(p.velocity, 0.016);
      p.velocity.multiplyScalar(0.85); // drag effect
      
      dummy.position.copy(p.position);
      const currentScale = p.scale * (1 - Math.pow(progress, 2)); // shrink slightly faster at the end
      dummy.scale.set(currentScale, currentScale, currentScale);
      dummy.updateMatrix();
      meshRef.current!.setMatrixAt(i, dummy.matrix);
    });
    meshRef.current.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={meshRef} args={[undefined, undefined, count]}>
      <sphereGeometry args={[0.08, 8, 8]} />
      <meshStandardMaterial color={explosion.color} emissive={explosion.color} emissiveIntensity={1.5} roughness={0.2} />
    </instancedMesh>
  );
}

function TargetMesh({ target, onHit }: { target: RoundTarget; onHit: (worldPos: { x: number; y: number; z: number }) => void }) {
  const group = useRef<THREE.Group>(null);
  const isBonus = target.target_type === "bonus";
  const radius = isBonus ? 0.48 : 0.68;
  
  const spawnTime = useRef<number>(0);
  const initialized = useRef(false);

  const easeOutBack = (x: number): number => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  };

  useFrame(({ clock }) => {
    if (!group.current) return;
    if (!initialized.current) {
      spawnTime.current = clock.elapsedTime;
      initialized.current = true;
    }
    
    const age = clock.elapsedTime - spawnTime.current;
    
    // Spawn animation
    let scale = 1;
    if (age < 0.2) {
      scale = easeOutBack(age / 0.2);
    }
    
    // Idle pulsing
    const pulse = scale + Math.sin(clock.elapsedTime * 7) * 0.045 * (age > 0.2 ? 1 : 0);
    group.current.scale.setScalar(Math.max(0, pulse));
    group.current.rotation.z = Math.sin(clock.elapsedTime * 2.5) * 0.08;
  });

  const hit = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    onHit({ x: event.point.x, y: event.point.y, z: event.point.z });
  };

  return (
    <group ref={group} position={[target.pos_x, target.pos_y, target.pos_z]} onPointerDown={hit}>
      <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
        <cylinderGeometry args={[radius, radius, 0.18, 40]} />
        <meshStandardMaterial color={isBonus ? "#f7c948" : "#fb5f4a"} emissive={isBonus ? "#8a5b00" : "#7d1e18"} emissiveIntensity={0.48} roughness={0.35} metalness={0.12} />
      </mesh>
      
      <mesh position={[0, 0, 0.11]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[radius * 0.62, radius * 0.62, 0.08, 40]} />
        <meshStandardMaterial color={isBonus ? "#fff4b8" : "#fff7ed"} />
      </mesh>
      
      <mesh position={[0, 0, 0.17]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[radius * 0.28, radius * 0.28, 0.07, 40]} />
        <meshStandardMaterial color={isBonus ? "#f59e0b" : "#ef4444"} emissive={isBonus ? "#7c4a03" : "#7f1d1d"} emissiveIntensity={0.35} />
      </mesh>
      
      {/* Target glow elements */}
      {isBonus ? (
        <pointLight color="#fbbf24" intensity={7} distance={3.5} />
      ) : (
        <pointLight color="#fb5f4a" intensity={4} distance={2.5} />
      )}
      <mesh position={[0, 0, -0.05]}>
        <ringGeometry args={[radius + 0.05, radius + 0.15, 32]} />
        <meshBasicMaterial color={isBonus ? "#fbbf24" : "#fb5f4a"} transparent opacity={0.3} depthWrite={false} />
      </mesh>
    </group>
  );
}

export function TargetArena({ target, onHit, disabled }: { target: RoundTarget | null; onHit: (target: RoundTarget, worldPos: { x: number; y: number; z: number }) => void; disabled?: boolean }) {
  const [explosions, setExplosions] = useState<ExplosionState[]>([]);

  const handleHit = (hitTarget: RoundTarget, worldPos: { x: number; y: number; z: number }) => {
    const isBonus = hitTarget.target_type === "bonus";
    const color = isBonus ? "#f7c948" : "#fb5f4a";
    
    const newExplosion = {
      id: Math.random().toString(),
      x: worldPos.x,
      y: worldPos.y,
      z: worldPos.z,
      color,
      createdAt: Date.now()
    };
    
    setExplosions(prev => [...prev, newExplosion]);
    
    setTimeout(() => {
      setExplosions(prev => prev.filter(e => e.id !== newExplosion.id));
    }, 500);
    
    onHit(hitTarget, worldPos);
  };

  return (
    <div className="arena-cursor cursor-crosshair h-full min-h-[360px] w-full touch-none overflow-hidden rounded-[1.35rem] bg-[#07111f]">
      <Canvas camera={{ position: [0, 0, 8], fov: 48 }} dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: "high-performance" }} shadows>
        <CameraController />
        <color attach="background" args={["#07111f"]} />
        <fog attach="fog" args={["#07111f", 9, 17]} />
        <ambientLight intensity={1.15} />
        <directionalLight castShadow position={[4, 6, 8]} intensity={2.2} color="#dbeafe" />
        <pointLight position={[-5, -3, 4]} intensity={12} color="#22d3ee" distance={12} />
        <pointLight position={[5, 3, 2]} intensity={10} color="#fb7185" distance={10} />
        
        <mesh position={[0, 0, -1.5]} receiveShadow>
          <planeGeometry args={[16, 16]} />
          <meshStandardMaterial color="#0c1b2d" roughness={0.92} metalness={0.08} />
        </mesh>
        
        <BackgroundAtmosphere />

        {explosions.map(exp => (
          <ExplosionParticles key={exp.id} explosion={exp} />
        ))}

        {target && !disabled && (
          <TargetMesh 
            key={target.target_index} 
            target={target} 
            onHit={(pos) => handleHit(target, pos)} 
          />
        )}
      </Canvas>
    </div>
  );
}
