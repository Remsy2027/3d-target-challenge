"use client";

import { Canvas, type ThreeEvent, useFrame } from "@react-three/fiber";
import { useRef } from "react";
import type { Group } from "three";
import type { RoundTarget } from "@/lib/game-types";

function TargetMesh({ target, onHit }: { target: RoundTarget; onHit: () => void }) {
  const group = useRef<Group>(null);
  const isBonus = target.target_type === "bonus";
  const radius = isBonus ? 0.48 : 0.68;

  useFrame(({ clock }) => {
    if (!group.current) return;
    const pulse = 1 + Math.sin(clock.elapsedTime * 7) * 0.045;
    group.current.scale.setScalar(pulse);
    group.current.rotation.z = Math.sin(clock.elapsedTime * 2.5) * 0.08;
  });

  const hit = (event: ThreeEvent<PointerEvent>) => {
    event.stopPropagation();
    onHit();
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
      {isBonus && <pointLight color="#fbbf24" intensity={7} distance={3.5} />}
    </group>
  );
}

export function TargetArena({ target, onHit, disabled }: { target: RoundTarget | null; onHit: (target: RoundTarget) => void; disabled?: boolean }) {
  return (
    <div className="h-full min-h-[360px] w-full touch-none overflow-hidden rounded-[1.35rem] bg-[#07111f]">
      <Canvas camera={{ position: [0, 0, 8], fov: 48 }} dpr={[1, 1.5]} gl={{ antialias: true, powerPreference: "high-performance" }} shadows>
        <color attach="background" args={["#07111f"]} />
        <fog attach="fog" args={["#07111f", 9, 17]} />
        <ambientLight intensity={1.15} />
        <directionalLight castShadow position={[4, 6, 8]} intensity={2.2} color="#dbeafe" />
        <pointLight position={[-5, -3, 4]} intensity={12} color="#22d3ee" distance={12} />
        <pointLight position={[5, 3, 2]} intensity={10} color="#fb7185" distance={10} />
        <mesh position={[0, 0, -1.5]} receiveShadow>
          <planeGeometry args={[16, 10]} />
          <meshStandardMaterial color="#0c1b2d" roughness={0.92} metalness={0.08} />
        </mesh>
        {target && !disabled && <TargetMesh key={target.target_index} target={target} onHit={() => onHit(target)} />}
      </Canvas>
    </div>
  );
}
