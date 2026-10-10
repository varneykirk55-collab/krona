/**
 * KRONA — scene composition & the seated first-person camera.
 */
import { memo, useMemo, useRef } from "react";
import * as THREE from "three";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Tavern } from "../three/Tavern";
import { Chair, PokerTable, SeatShadow } from "../three/PokerTable";
import { Viking } from "../three/Viking";
import { Cards, ChipField, DealerButton, FirstPersonHands, SeatLabelProjector } from "../three/TableProps";
import { useGame } from "../game/store";
import { game } from "../game/controller";
import { feltPoint } from "../game/view";

function CameraRig() {
  const { camera } = useThree();
  const look = useRef(new THREE.Vector3(0, 0.74, -0.4));
  const target = useRef(new THREE.Vector3());
  const lookTarget = useRef(new THREE.Vector3());
  useFrame((state, dt) => {
    const t = state.clock.elapsedTime;
    const peek = game.view.peek;
    const paused = game.paused;
    const sway = paused ? 0 : 1;
    // seated eye height, leaning in when checking hole cards
    target.current.set(
      Math.sin(t * 0.23) * 0.012 * sway,
      1.25 - peek * 0.1 + Math.sin(t * 0.9) * 0.0035 * sway,
      1.52 - peek * 0.16
    );
    lookTarget.current.set(0, 0.74 + peek * 0.16, -0.42 + peek * 0.72);
    const k = Math.min(1, dt * 4);
    camera.position.lerp(target.current, k);
    look.current.lerp(lookTarget.current, k);
    camera.lookAt(look.current);
  });
  return null;
}

const Figures = memo(function Figures() {
  const snapshot = useGame((s) => s.snapshot);
  const seats = snapshot?.seats ?? [];
  return (
    <group>
      {seats.map((s, i) =>
        s && s.cast ? (
          <group key={i}>
            <Viking seatIndex={i} cast={s.cast} />
          </group>
        ) : null
      )}
    </group>
  );
});

function BoardHighlight() {
  const ref = useRef<THREE.Mesh>(null);
  const target = useRef(new THREE.Vector3());
  useFrame((_, dt) => {
    if (!ref.current) return;
    const seats = game.seats;
    let found: number | null = null;
    for (let i = 0; i < seats.length; i++) {
      const s = seats[i];
      if (s && game.engine?.state.actionSeat === i && !s.folded) found = i;
    }
    const active = game.awaitingHuman ? 0 : found;
    if (active == null) {
      ref.current.visible = false;
      return;
    }
    const p = feltPoint(active, 0.2);
    target.current.set(p.x, 0.784, p.z);
    ref.current.position.lerp(target.current, Math.min(1, dt * 6));
    ref.current.visible = true;
  });
  return (
    <mesh ref={ref} rotation={[-Math.PI / 2, 0, 0]} visible={false}>
      <ringGeometry args={[0.2, 0.27, 24, 1, 0, Math.PI * 1.5]} />
      <meshBasicMaterial color="#f2c53d" transparent opacity={0.32} depthWrite={false} />
    </mesh>
  );
}

export function Scene() {
  const quality = useGame((s) => s.settings.quality);
  const dpr: [number, number] = quality === "low" ? [0.7, 1] : quality === "medium" ? [1, 1.5] : [1, 2];
  const chairs = useMemo(() => Array.from({ length: 8 }, (_, i) => i), []);
  return (
    <Canvas
      shadows={quality !== "low"}
      dpr={dpr}
      gl={{ antialias: quality === "high", powerPreference: "high-performance", alpha: false }}
      camera={{ fov: 52, position: [0, 1.25, 1.52], near: 0.05, far: 90 }}
      onCreated={({ gl, scene }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        scene.fog = new THREE.Fog(new THREE.Color("#1b2530"), 9, 34);
      }}
    >
      <color attach="background" args={["#0b1016"]} />
      <CameraRig />
      <Tavern quality={quality} />
      <PokerTable />
      {chairs.map((i) => (
        <Chair key={i} seatIndex={i} />
      ))}
      {chairs.map((i) => (
        <SeatShadow key={`sh${i}`} seatIndex={i} />
      ))}
      <Figures />
      <Cards />
      <ChipField />
      <DealerButton />
      <BoardHighlight />
      <FirstPersonHands />
      <SeatLabelProjector />
    </Canvas>
  );
}
