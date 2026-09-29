"use client";

import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, useState, useMemo } from "react";
import * as THREE from "three";
import type { RoundTarget, ArenaTheme, TargetType } from "@/lib/game-types";

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
    const aspect = Math.max(size.width / size.height, 0.2);
    const distance = 8;
    // Keep the whole playfield (x [-3.3, 3.3], y [-2.1, 2.1]) visible with a little
    // padding on ANY canvas shape — portrait phones through ultrawide laptops — instead
    // of leaving the target tiny inside a mostly empty frame.
    const halfWidth = 3.7;
    const halfHeight = 2.65;

    if (camera instanceof THREE.PerspectiveCamera) {
      const fovForHeight = 2 * Math.atan(halfHeight / distance);
      const fovForWidth = 2 * Math.atan(halfWidth / aspect / distance);
      const fovDeg = Math.max(fovForHeight, fovForWidth) * (180 / Math.PI);
      camera.fov = Math.min(72, Math.max(34, fovDeg));
      camera.updateProjectionMatrix();
    }
  }, [camera, size]);

  return null;
}

function BackgroundAtmosphere({ theme }: { theme: ArenaTheme }) {
  const gridRef = useRef<THREE.GridHelper>(null);
  
  useFrame(({ clock }) => {
    if (gridRef.current) {
      // Slowly drift the grid
      gridRef.current.position.y = (clock.elapsedTime * 0.15) % 1;
    }
  });
  
  const gridColors = {
    cyber: ["#1e3a8a", "#0f172a"],
    volcanic: ["#991b1b", "#450a0a"],
    neon: ["#d946ef", "#701a75"]
  } as const;

  const [color1, color2] = gridColors[theme] || gridColors.cyber;
  
  return (
    <group rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -1.4]}>
      <gridHelper ref={gridRef} args={[30, 30, color1, color2]} />
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
  const type = target.target_type;
  
  let radius = 0.68;
  let outerColor = "#fb5f4a";
  let outerEmissive = "#7d1e18";
  let innerColor = "#fff7ed";
  let coreColor = "#ef4444";
  let coreEmissive = "#7f1d1d";
  let lightColor = "#fb5f4a";
  let geometryType = "cylinder";
  
  switch (type) {
    case "bonus":
      radius = 0.48;
      outerColor = "#f7c948";
      outerEmissive = "#8a5b00";
      innerColor = "#fff4b8";
      coreColor = "#f59e0b";
      coreEmissive = "#7c4a03";
      lightColor = "#fbbf24";
      break;
    case "decoy":
      outerColor = "#3f3f46";
      outerEmissive = "#18181b";
      innerColor = "#52525b";
      coreColor = "#27272a";
      coreEmissive = "#000000";
      lightColor = "#71717a";
      break;
    case "speed":
      radius = 0.4;
      outerColor = "#3b82f6";
      outerEmissive = "#1e3a8a";
      innerColor = "#eff6ff";
      coreColor = "#2563eb";
      coreEmissive = "#1e40af";
      lightColor = "#60a5fa";
      break;
    case "moving":
      outerColor = "#22c55e";
      outerEmissive = "#14532d";
      innerColor = "#f0fdf4";
      coreColor = "#16a34a";
      coreEmissive = "#166534";
      lightColor = "#4ade80";
      break;
    case "time_freeze":
      outerColor = "#38bdf8";
      outerEmissive = "#0c4a6e";
      innerColor = "#f0f9ff";
      coreColor = "#0284c7";
      coreEmissive = "#075985";
      lightColor = "#7dd3fc";
      geometryType = "octahedron";
      break;
    case "double_points":
      outerColor = "#a855f7";
      outerEmissive = "#4c1d95";
      innerColor = "#faf5ff";
      coreColor = "#9333ea";
      coreEmissive = "#5b21b6";
      lightColor = "#c084fc";
      geometryType = "dodecahedron";
      break;
    case "shield":
      outerColor = "#10b981";
      outerEmissive = "#064e3b";
      innerColor = "#ecfdf5";
      coreColor = "#059669";
      coreEmissive = "#065f46";
      lightColor = "#34d399";
      geometryType = "hexagon";
      break;
    case "normal":
    default:
      break;
  }
  
  const spawnTime = useRef<number>(0);
  const initialized = useRef(false);
  const velocity = useRef(new THREE.Vector2(target.velocity_x ?? 0, target.velocity_y ?? 0));

  const easeOutBack = (x: number): number => {
    const c1 = 1.70158;
    const c3 = c1 + 1;
    return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
  };

  useFrame(({ clock }, delta) => {
    if (!group.current) return;
    if (!initialized.current) {
      spawnTime.current = clock.elapsedTime;
      initialized.current = true;
    }

    // Moving target logic. Bounce off the playfield bounds so a moving target can
    // never drift out of the visible area and become unclickable (especially on
    // phones, where the visible frame is tighter).
    const vx = velocity.current.x;
    const vy = velocity.current.y;
    if (vx || vy) {
      let nextX = group.current.position.x + vx * delta;
      let nextY = group.current.position.y + vy * delta;
      if (nextX > 3.05 || nextX < -3.05) { velocity.current.x = -vx; nextX = THREE.MathUtils.clamp(nextX, -3.05, 3.05); }
      if (nextY > 1.85 || nextY < -1.85) { velocity.current.y = -vy; nextY = THREE.MathUtils.clamp(nextY, -1.85, 1.85); }
      group.current.position.x = nextX;
      group.current.position.y = nextY;
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
    
    // Base rotation
    group.current.rotation.z = Math.sin(clock.elapsedTime * 2.5) * 0.08;
    
    // Dynamic spin for 3D shapes
    if (geometryType === "octahedron" || geometryType === "dodecahedron") {
      group.current.rotation.x += delta * 0.5;
      group.current.rotation.y += delta * 1.5;
    }
  });

  const hit = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    onHit({ x: event.point.x, y: event.point.y, z: event.point.z });
  };

  const renderGeometry = () => {
    switch (geometryType) {
      case "octahedron": return <octahedronGeometry args={[radius, 0]} />;
      case "dodecahedron": return <dodecahedronGeometry args={[radius, 0]} />;
      case "hexagon": return <cylinderGeometry args={[radius, radius, 0.18, 6]} />;
      case "cylinder":
      default: return <cylinderGeometry args={[radius, radius, 0.18, 40]} />;
    }
  };

  const renderInnerGeometry = () => {
    switch (geometryType) {
      case "octahedron": return <octahedronGeometry args={[radius * 0.62, 0]} />;
      case "dodecahedron": return <dodecahedronGeometry args={[radius * 0.62, 0]} />;
      case "hexagon": return <cylinderGeometry args={[radius * 0.62, radius * 0.62, 0.08, 6]} />;
      case "cylinder":
      default: return <cylinderGeometry args={[radius * 0.62, radius * 0.62, 0.08, 40]} />;
    }
  };

  const renderCoreGeometry = () => {
    switch (geometryType) {
      case "octahedron": return <octahedronGeometry args={[radius * 0.28, 0]} />;
      case "dodecahedron": return <dodecahedronGeometry args={[radius * 0.28, 0]} />;
      case "hexagon": return <cylinderGeometry args={[radius * 0.28, radius * 0.28, 0.07, 6]} />;
      case "cylinder":
      default: return <cylinderGeometry args={[radius * 0.28, radius * 0.28, 0.07, 40]} />;
    }
  };

  const isFlat = geometryType === "cylinder" || geometryType === "hexagon";
  const rot: [number, number, number] = isFlat ? [Math.PI / 2, 0, 0] : [0, 0, 0];

  return (
    <group ref={group} position={[target.pos_x, target.pos_y, target.pos_z]} onPointerDown={hit}>
      <mesh rotation={rot} castShadow>
        {renderGeometry()}
        <meshStandardMaterial color={outerColor} emissive={outerEmissive} emissiveIntensity={0.48} roughness={0.35} metalness={0.12} />
      </mesh>
      
      <mesh position={[0, 0, 0.11]} rotation={rot}>
        {renderInnerGeometry()}
        <meshStandardMaterial color={innerColor} />
      </mesh>
      
      <mesh position={[0, 0, 0.17]} rotation={rot}>
        {renderCoreGeometry()}
        <meshStandardMaterial color={coreColor} emissive={coreEmissive} emissiveIntensity={0.35} />
      </mesh>
      
      <pointLight color={lightColor} intensity={type === "bonus" ? 7 : 4} distance={type === "bonus" ? 3.5 : 2.5} />
      <mesh position={[0, 0, -0.05]}>
        <ringGeometry args={[radius + 0.05, radius + 0.15, 32]} />
        <meshBasicMaterial color={lightColor} transparent opacity={0.3} depthWrite={false} />
      </mesh>
    </group>
  );
}

const getTargetColor = (type: TargetType) => {
  switch (type) {
    case "bonus": return "#f7c948";
    case "decoy": return "#71717a";
    case "speed": return "#60a5fa";
    case "moving": return "#4ade80";
    case "time_freeze": return "#7dd3fc";
    case "double_points": return "#c084fc";
    case "shield": return "#34d399";
    case "normal":
    default: return "#fb5f4a";
  }
};

export function TargetArena({ 
  target, 
  onHit, 
  disabled,
  theme = "cyber"
}: { 
  target: RoundTarget | null; 
  onHit: (target: RoundTarget, worldPos: { x: number; y: number; z: number }) => void; 
  disabled?: boolean;
  theme?: ArenaTheme;
}) {
  const [explosions, setExplosions] = useState<ExplosionState[]>([]);

  const handleHit = (hitTarget: RoundTarget, worldPos: { x: number; y: number; z: number }) => {
    const color = getTargetColor(hitTarget.target_type);
    
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

  const themeConfig = {
    cyber: {
      bg: "#07111f",
      dirLight: "#dbeafe",
      point1: "#22d3ee",
      point2: "#fb7185",
      floor: "#0c1b2d"
    },
    volcanic: {
      bg: "#1a0a0a",
      dirLight: "#ffedd5",
      point1: "#f97316",
      point2: "#ef4444",
      floor: "#2a0a0a"
    },
    neon: {
      bg: "#0a0520",
      dirLight: "#f3e8ff",
      point1: "#d946ef",
      point2: "#4ade80",
      floor: "#1a0b36"
    }
  };

  const currentTheme = themeConfig[theme] || themeConfig.cyber;

  return (
    <div className="arena-cursor h-full w-full touch-none overflow-hidden" style={{ backgroundColor: currentTheme.bg }}>
      <Canvas camera={{ position: [0, 0, 8], fov: 48 }} dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: "high-performance" }} shadows>
        <CameraController />
        <color attach="background" args={[currentTheme.bg]} />
        <fog attach="fog" args={[currentTheme.bg, 9, 17]} />
        <ambientLight intensity={1.15} />
        <directionalLight castShadow position={[4, 6, 8]} intensity={2.2} color={currentTheme.dirLight} />
        <pointLight position={[-5, -3, 4]} intensity={12} color={currentTheme.point1} distance={12} />
        <pointLight position={[5, 3, 2]} intensity={10} color={currentTheme.point2} distance={10} />
        
        <mesh position={[0, 0, -1.5]} receiveShadow>
          <planeGeometry args={[16, 16]} />
          <meshStandardMaterial color={currentTheme.floor} roughness={0.92} metalness={0.08} />
        </mesh>
        
        <BackgroundAtmosphere theme={theme} />

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
