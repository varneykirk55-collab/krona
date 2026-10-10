/**
 * KRONA — the Viking tavern and the snowy village beyond the windows.
 */
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { MATS } from "./materials";
import { nightSkyTexture, runeTexture, snowflakeTexture } from "./textures";

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */

function Panel({
  pos,
  size,
  mat = MATS.darkOak,
}: {
  pos: [number, number, number];
  size: [number, number, number];
  mat?: THREE.Material;
}) {
  return (
    <mesh position={pos} material={mat} castShadow={false} receiveShadow>
      <boxGeometry args={size} />
    </mesh>
  );
}

function Beam({ pos, size, rot = [0, 0, 0] }: { pos: [number, number, number]; size: [number, number, number]; rot?: [number, number, number] }) {
  return (
    <mesh position={pos} rotation={rot} material={MATS.oak} castShadow={false}>
      <boxGeometry args={size} />
    </mesh>
  );
}

function Candle({ pos, flameRef }: { pos: [number, number, number]; flameRef?: React.MutableRefObject<number> }) {
  const f = useRef<THREE.Mesh>(null);
  useFrame((s) => {
    if (!f.current) return;
    const t = s.clock.elapsedTime;
    const k = 0.8 + Math.sin(t * 11 + pos[0] * 3) * 0.12 + Math.sin(t * 23.3 + pos[2]) * 0.06;
    f.current.scale.set(1, k, 1);
    if (flameRef) flameRef.current = k;
  });
  return (
    <group position={pos}>
      <mesh material={MATS.iron}>
        <cylinderGeometry args={[0.035, 0.045, 0.012, 12]} />
      </mesh>
      <mesh position={[0, 0.07, 0]} material={MATS.candle}>
        <cylinderGeometry args={[0.018, 0.022, 0.14, 12]} />
      </mesh>
      <mesh ref={f} position={[0, 0.17, 0]} material={MATS.flame}>
        <coneGeometry args={[0.014, 0.05, 8]} />
      </mesh>
      <pointLight position={[0, 0.2, 0]} color="#ffb257" intensity={0.5} distance={3.2} decay={2} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* fireplace                                                          */
/* ------------------------------------------------------------------ */

function Fireplace() {
  const light = useRef<THREE.PointLight>(null);
  const flames = useRef<THREE.Group>(null);
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    const f = 2.6 + Math.sin(t * 7.1) * 0.35 + Math.sin(t * 17.3) * 0.18 + Math.sin(t * 3.3) * 0.22;
    if (light.current) light.current.intensity = f;
    if (flames.current) {
      flames.current.children.forEach((c, i) => {
        const m = c as THREE.Mesh;
        const k = 0.75 + Math.sin(t * (6 + i) + i * 1.7) * 0.25;
        m.scale.set(0.9 + k * 0.2, k, 0.9 + k * 0.2);
        const mat = m.material as THREE.MeshBasicMaterial;
        mat.opacity = 0.5 + k * 0.35;
      });
    }
  });
  const logs = [
    { p: [0, 0.14, 0.1], r: [0, 0.3, 0.05] },
    { p: [0.05, 0.2, 0.05], r: [0.2, 1.2, -0.1] },
    { p: [-0.06, 0.26, 0.02], r: [-0.1, 0.6, 0.14] },
  ] as const;
  return (
    <group position={[0, 0, -4.32]}>
      {/* stone hearth */}
      <Panel pos={[0, 1.05, 0]} size={[3.5, 2.1, 0.6]} mat={MATS.stone} />
      <Panel pos={[0, 0.3, 0.35]} size={[3.2, 0.6, 0.25]} mat={MATS.stone} />
      {/* firebox opening */}
      <Panel pos={[0, 0.75, 0.3]} size={[2.1, 1.0, 0.05]} mat={new THREE.MeshBasicMaterial({ color: "#120c08" })} />
      {/* oak mantel */}
      <Panel pos={[0, 2.2, 0.16]} size={[3.8, 0.24, 0.85]} mat={MATS.oak} />
      <Panel pos={[0, 2.42, 0.2]} size={[4.0, 0.1, 0.95]} mat={MATS.darkOak} />
      {/* carved mantel knotwork */}
      <mesh position={[0, 2.34, 0.62]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[3.6, 0.2]} />
        <meshStandardMaterial map={runeTexture()} roughness={0.6} metalness={0.35} color="#d8b45c" />
      </mesh>
      {/* logs + embers */}
      {logs.map((l, i) => (
        <mesh key={i} position={l.p as unknown as [number, number, number]} rotation={l.r as unknown as [number, number, number]} material={MATS.darkOak}>
          <cylinderGeometry args={[0.075, 0.09, 1.05, 10]} />
        </mesh>
      ))}
      <mesh position={[0, 0.1, 0.05]}>
        <planeGeometry args={[1.7, 0.6]} />
        <meshBasicMaterial color="#ff5a1e" />
      </mesh>
      {/* flames */}
      <group ref={flames} position={[0, 0.55, 0.12]}>
        {[-0.35, -0.12, 0.05, 0.26, 0.44].map((x, i) => (
          <mesh key={i} position={[x, i * 0.05, (i % 2) * 0.06 - 0.03]}>
            <coneGeometry args={[0.12 - i * 0.008, 0.5 + (i % 3) * 0.12, 7]} />
            <meshBasicMaterial color={i % 2 ? "#ffca6b" : "#ff8a2e"} transparent opacity={0.75} depthWrite={false} />
          </mesh>
        ))}
      </group>
      <pointLight ref={light} position={[0, 1.1, 0.9]} color="#ff8a3c" intensity={2.6} distance={13} decay={2} />
      {/* hanging pots */}
      <mesh position={[0.75, 1.7, 0.4]} material={MATS.iron}>
        <cylinderGeometry args={[0.16, 0.13, 0.22, 14]} />
      </mesh>
      <mesh position={[0.75, 2.0, 0.4]} material={MATS.iron}>
        <cylinderGeometry args={[0.008, 0.008, 0.6, 6]} />
      </mesh>
      {/* drinking horns on the mantel */}
      {[-1.2, -1.0, 1.15].map((x, i) => (
        <group key={i} position={[x, 2.56, 0.25]} rotation={[0, 0, -0.5 + i * 0.3]}>
          <mesh rotation={[0, 0, Math.PI / 2]}>
            <coneGeometry args={[0.05, 0.34, 10]} />
            <meshStandardMaterial color={i % 2 ? "#3a2a1c" : "#c9b48c"} roughness={0.45} metalness={0.05} />
          </mesh>
          <mesh position={[0.18, 0, 0]} material={MATS.brass}>
            <cylinderGeometry args={[0.012, 0.012, 0.06, 8]} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* windows                                                            */
/* ------------------------------------------------------------------ */

function Window({ pos, rot = [0, 0, 0], w = 2.0, h = 1.7 }: { pos: [number, number, number]; rot?: [number, number, number]; w?: number; h?: number }) {
  return (
    <group position={pos} rotation={rot}>
      {/* frame */}
      <Panel pos={[0, h / 2 + 0.06, 0]} size={[w + 0.24, 0.12, 0.14]} mat={MATS.oak} />
      <Panel pos={[0, -h / 2 - 0.06, 0]} size={[w + 0.24, 0.12, 0.14]} mat={MATS.oak} />
      <Panel pos={[-w / 2 - 0.06, 0, 0]} size={[0.12, h + 0.24, 0.14]} mat={MATS.oak} />
      <Panel pos={[w / 2 + 0.06, 0, 0]} size={[0.12, h + 0.24, 0.14]} mat={MATS.oak} />
      {/* mullions */}
      <Panel pos={[0, 0, 0]} size={[0.07, h, 0.09]} mat={MATS.darkOak} />
      <Panel pos={[0, 0, 0]} size={[w, 0.07, 0.09]} mat={MATS.darkOak} />
      {/* glazing */}
      <mesh position={[0, 0, -0.02]} material={MATS.glass}>
        <planeGeometry args={[w, h]} />
      </mesh>
      {/* shutters */}
      <Panel pos={[-w / 2 - 0.24, 0, 0.02]} size={[0.34, h + 0.1, 0.05]} mat={MATS.darkOak} />
      <Panel pos={[w / 2 + 0.24, 0, 0.02]} size={[0.34, h + 0.1, 0.05]} mat={MATS.darkOak} />
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* snowy village seen through the windows                             */
/* ------------------------------------------------------------------ */

function House({ pos, rot, w, d, h }: { pos: [number, number, number]; rot: number; w: number; d: number; h: number }) {
  const timber = useMemo(
    () =>
      new THREE.MeshStandardMaterial({
        color: "#4a3524",
        roughness: 0.85,
        map: MATS.darkOak.map,
      }),
    []
  );
  return (
    <group position={pos} rotation={[0, rot, 0]}>
      <mesh position={[0, h / 2, 0]} material={timber} castShadow={false}>
        <boxGeometry args={[w, h, d]} />
      </mesh>
      {/* snowy roof */}
      <mesh position={[0, h + 0.34, 0]} rotation={[0, Math.PI / 4, 0]} material={MATS.snow}>
        <coneGeometry args={[Math.max(w, d) * 0.82, 0.9, 4]} />
      </mesh>
      {/* warm windows */}
      {[-1, 1].map((sx) => (
        <mesh key={sx} position={[sx * w * 0.26, h * 0.55, d / 2 + 0.02]}>
          <planeGeometry args={[0.34, 0.42]} />
          <meshBasicMaterial color="#ffbe6a" />
        </mesh>
      ))}
      {/* snow at the base */}
      <mesh position={[0, 0.06, 0]} material={MATS.snow}>
        <boxGeometry args={[w + 0.5, 0.12, d + 0.5]} />
      </mesh>
      {/* smoke */}
      <mesh position={[0.2, h + 1.1, 0]}>
        <sphereGeometry args={[0.3, 8, 6]} />
        <meshBasicMaterial color="#5a6068" transparent opacity={0.25} depthWrite={false} />
      </mesh>
    </group>
  );
}

function Village() {
  const trees = useMemo(() => {
    const arr: { p: [number, number, number]; s: number }[] = [];
    for (let i = 0; i < 16; i++) {
      const x = -22 + Math.random() * 44;
      const z = -26 + Math.random() * 12;
      arr.push({ p: [x, 0, z], s: 2.2 + Math.random() * 2.4 });
    }
    return arr;
  }, []);
  return (
    <group>
      {/* sky dome backdrop */}
      <mesh position={[0, 6, -30]}>
        <planeGeometry args={[140, 50]} />
        <meshBasicMaterial map={nightSkyTexture()} />
      </mesh>
      {/* snow covered ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, -16]} material={MATS.snow} receiveShadow={false}>
        <planeGeometry args={[130, 60]} />
      </mesh>
      <House pos={[-8.5, 0, -13]} rot={0.1} w={4.2} d={3.4} h={2.6} />
      <House pos={[-3.2, 0, -17]} rot={-0.15} w={5} d={3.8} h={3} />
      <House pos={[2.6, 0, -14]} rot={0.05} w={4.4} d={3.2} h={2.7} />
      <House pos={[8.4, 0, -18]} rot={-0.2} w={5.4} d={4} h={3.2} />
      <House pos={[14.5, 0, -12]} rot={0.3} w={3.8} d={3} h={2.4} />
      <House pos={[-14.5, 0, -11]} rot={-0.3} w={4} d={3.2} h={2.5} />
      <House pos={[-20, 0, -20]} rot={0} w={5.6} d={4.2} h={3.4} />
      <House pos={[21, 0, -21]} rot={0} w={5.2} d={4} h={3.2} />
      {/* fences along a snow path */}
      {Array.from({ length: 14 }).map((_, i) => (
        <group key={i} position={[-12 + i * 1.9, 0, -9.2]}>
          <mesh position={[0, 0.6, 0]} material={MATS.darkOak}>
            <boxGeometry args={[0.12, 1.2, 0.12]} />
          </mesh>
          <mesh position={[0.9, 0.8, 0]} material={MATS.darkOak}>
            <boxGeometry args={[1.8, 0.1, 0.06]} />
          </mesh>
          <mesh position={[0.9, 0.5, 0]} material={MATS.darkOak}>
            <boxGeometry args={[1.8, 0.1, 0.06]} />
          </mesh>
          <mesh position={[0, 1.26, 0]} material={MATS.snow}>
            <boxGeometry args={[0.18, 0.1, 0.18]} />
          </mesh>
        </group>
      ))}
      {/* distant pines */}
      {trees.map((t, i) => (
        <group key={i} position={t.p}>
          <mesh position={[0, t.s * 0.2, 0]} material={MATS.darkOak}>
            <cylinderGeometry args={[0.12, 0.18, t.s * 0.4, 6]} />
          </mesh>
          <mesh position={[0, t.s * 0.65, 0]} material={MATS.snow}>
            <coneGeometry args={[t.s * 0.36, t.s * 1.1, 7]} />
          </mesh>
          <mesh position={[0, t.s * 1.05, 0]} material={MATS.snow}>
            <coneGeometry args={[t.s * 0.26, t.s * 0.7, 7]} />
          </mesh>
        </group>
      ))}
      {/* low mist for atmospheric perspective */}
      <mesh position={[0, 1.2, -18]}>
        <planeGeometry args={[120, 14]} />
        <meshBasicMaterial color="#93a7bb" transparent opacity={0.16} depthWrite={false} />
      </mesh>
    </group>
  );
}

function Snowfall({ count = 420 }: { count?: number }) {
  const ref = useRef<THREE.Points>(null);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      pos[i * 3] = -24 + Math.random() * 48;
      pos[i * 3 + 1] = Math.random() * 14;
      pos[i * 3 + 2] = -30 + Math.random() * 34;
    }
    g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    return g;
  }, [count]);
  const mat = useMemo(
    () =>
      new THREE.PointsMaterial({
        map: snowflakeTexture(),
        size: 0.13,
        transparent: true,
        opacity: 0.85,
        depthWrite: false,
        sizeAttenuation: true,
        color: "#ffffff",
      }),
    []
  );
  useFrame((_, dt) => {
    const p = geo.getAttribute("position") as THREE.BufferAttribute;
    const a = p.array as Float32Array;
    for (let i = 0; i < count; i++) {
      a[i * 3 + 1] -= dt * (0.5 + (i % 5) * 0.14);
      a[i * 3] += dt * 0.35;
      if (a[i * 3 + 1] < 0) a[i * 3 + 1] = 13 + Math.random() * 2;
      if (a[i * 3] > 26) a[i * 3] -= 50;
    }
    p.needsUpdate = true;
    if (ref.current) ref.current.visible = true;
  });
  return <points ref={ref} geometry={geo} material={mat} frustumCulled={false} />;
}

/* ------------------------------------------------------------------ */
/* wall props                                                         */
/* ------------------------------------------------------------------ */

function Shield({ pos, rot, color }: { pos: [number, number, number]; rot: [number, number, number]; color: string }) {
  return (
    <group position={pos} rotation={rot}>
      <mesh>
        <cylinderGeometry args={[0.34, 0.3, 0.07, 20]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.25} />
      </mesh>
      <mesh position={[0, 0, 0.045]}>
        <cylinderGeometry args={[0.3, 0.28, 0.02, 20]} />
        <meshStandardMaterial map={runeTexture()} roughness={0.6} metalness={0.3} color="#cdb27a" />
      </mesh>
      <mesh position={[0, 0, 0.08]} material={MATS.brass}>
        <sphereGeometry args={[0.05, 10, 8]} />
      </mesh>
    </group>
  );
}

function Axe({ pos, rot }: { pos: [number, number, number]; rot: [number, number, number] }) {
  return (
    <group position={pos} rotation={rot}>
      <mesh material={MATS.darkOak}>
        <cylinderGeometry args={[0.025, 0.03, 1.15, 8]} />
      </mesh>
      <mesh position={[0, 0.52, 0.02]} material={MATS.iron}>
        <boxGeometry args={[0.06, 0.24, 0.16]} />
      </mesh>
      <mesh position={[0.1, 0.52, 0.02]} rotation={[0, 0, Math.PI / 2]} material={MATS.iron}>
        <cylinderGeometry args={[0.13, 0.1, 0.04, 3]} />
      </mesh>
      <mesh position={[0, 0.62, 0]} material={MATS.brass}>
        <torusGeometry args={[0.03, 0.008, 6, 10]} />
      </mesh>
    </group>
  );
}

function Sword({ pos, rot }: { pos: [number, number, number]; rot: [number, number, number] }) {
  return (
    <group position={pos} rotation={rot}>
      <mesh position={[0, 0.42, 0]}>
        <boxGeometry args={[0.05, 0.86, 0.012]} />
        <meshStandardMaterial color="#b9c0c8" roughness={0.25} metalness={0.95} />
      </mesh>
      <mesh position={[0, 0.0, 0]} material={MATS.brass}>
        <boxGeometry args={[0.26, 0.035, 0.035]} />
      </mesh>
      <mesh position={[0, -0.12, 0]} material={MATS.darkOak}>
        <cylinderGeometry args={[0.022, 0.025, 0.2, 8]} />
      </mesh>
      <mesh position={[0, -0.24, 0]} material={MATS.brass}>
        <sphereGeometry args={[0.03, 10, 8]} />
      </mesh>
    </group>
  );
}

function Barrel({ pos }: { pos: [number, number, number] }) {
  return (
    <group position={pos}>
      <mesh material={MATS.oak}>
        <cylinderGeometry args={[0.32, 0.28, 0.86, 16]} />
      </mesh>
      {[-0.28, 0, 0.28].map((y) => (
        <mesh key={y} position={[0, y, 0]} material={MATS.iron}>
          <torusGeometry args={[0.31, 0.018, 6, 18]} />
        </mesh>
      ))}
      <mesh position={[0, 0.45, 0]} material={MATS.darkOak}>
        <cylinderGeometry args={[0.3, 0.3, 0.05, 16]} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* the tavern                                                         */
/* ------------------------------------------------------------------ */

export function Tavern({ quality }: { quality: "low" | "medium" | "high" }) {
  const lanternA = useRef<THREE.PointLight>(null);
  const lanternB = useRef<THREE.PointLight>(null);
  useFrame((s) => {
    const t = s.clock.elapsedTime;
    if (lanternA.current) lanternA.current.intensity = 1.5 + Math.sin(t * 2.1) * 0.16;
    if (lanternB.current) lanternB.current.intensity = 1.4 + Math.sin(t * 1.7 + 1) * 0.16;
  });

  const W = 13;
  const D = 10;
  const H = 4.4;

  return (
    <group>
      {/* ---------------- shell ---------------- */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} material={MATS.floor} receiveShadow>
        <planeGeometry args={[W, D]} />
      </mesh>
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, H, 0]} material={MATS.ceiling}>
        <planeGeometry args={[W, D]} />
      </mesh>
      {/* far wall: fireplace in the middle, windows either side */}
      <Panel pos={[0, H / 2, -D / 2]} size={[W, H, 0.3]} mat={MATS.darkOak} />
      <Panel pos={[-4.6, H / 2, -D / 2 + 0.18]} size={[3.8, H, 0.06]} mat={new THREE.MeshStandardMaterial({ color: "#000000" })} />
      <Panel pos={[4.6, H / 2, -D / 2 + 0.18]} size={[3.8, H, 0.06]} mat={new THREE.MeshStandardMaterial({ color: "#000000" })} />
      <Window pos={[-3.9, 2.1, -D / 2 + 0.18]} w={2.2} h={1.8} />
      <Window pos={[3.9, 2.1, -D / 2 + 0.18]} w={2.2} h={1.8} />
      {/* side walls with a window each */}
      <Panel pos={[-W / 2, H / 2, 0]} size={[0.3, H, D]} mat={MATS.darkOak} />
      <Panel pos={[W / 2, H / 2, 0]} size={[0.3, H, D]} mat={MATS.darkOak} />
      <Window pos={[-W / 2 + 0.18, 2.1, -1.4]} rot={[0, Math.PI / 2, 0]} w={1.9} h={1.6} />
      <Window pos={[W / 2 - 0.18, 2.1, -1.4]} rot={[0, -Math.PI / 2, 0]} w={1.9} h={1.6} />
      {/* wall behind the player */}
      <Panel pos={[0, H / 2, D / 2]} size={[W, H, 0.3]} mat={MATS.darkOak} />
      <Panel pos={[0, 0.05, D / 2 - 0.2]} size={[2.2, 2.4, 0.1]} mat={MATS.oak} />
      {/* large wooden doors */}
      <group position={[-4.6, 0, D / 2 - 0.16]}>
        <mesh position={[0, 1.3, 0]} material={MATS.oak}>
          <boxGeometry args={[1.9, 2.6, 0.12]} />
        </mesh>
        <mesh position={[0, 1.3, -0.08]} material={MATS.iron}>
          <boxGeometry args={[2.0, 0.14, 0.04]} />
        </mesh>
        {[-0.45, 0.45].map((x) => (
          <mesh key={x} position={[x, 1.3, -0.12]} material={MATS.iron}>
            <torusGeometry args={[0.09, 0.016, 6, 12]} />
          </mesh>
        ))}
        <mesh position={[0, 2.72, 0]} material={MATS.darkOak}>
          <boxGeometry args={[2.2, 0.2, 0.2]} />
        </mesh>
      </group>

      {/* ---------------- structure ---------------- */}
      {[-W / 2 + 0.4, -W / 6, W / 6, W / 2 - 0.4].map((x) => (
        <Beam key={`c${x}`} pos={[x, H / 2, -D / 2 + 0.28]} size={[0.34, H, 0.34]} />
      ))}
      {[-D / 2 + 0.4, 0, D / 2 - 0.4].map((z) => (
        <Beam key={`s${z}`} pos={[-W / 2 + 0.28, H / 2, z]} size={[0.34, H, 0.34]} />
      ))}
      {[-D / 2 + 0.4, 0, D / 2 - 0.4].map((z) => (
        <Beam key={`sr${z}`} pos={[W / 2 - 0.28, H / 2, z]} size={[0.34, H, 0.34]} />
      ))}
      {/* rafters */}
      {[-3.6, -1.8, 0, 1.8, 3.6].map((x) => (
        <Beam key={`r${x}`} pos={[x, H - 0.22, 0]} size={[0.22, 0.28, D - 0.6]} />
      ))}
      {/* collar beams */}
      {[-3, 0, 3].map((z) => (
        <Beam key={`cb${z}`} pos={[0, H - 0.5, z]} size={[W - 0.6, 0.24, 0.24]} />
      ))}
      {/* iron brackets */}
      {[-3.6, 0, 3.6].map((x) => (
        <mesh key={`ib${x}`} position={[x, H - 0.42, -2.4]} material={MATS.iron}>
          <boxGeometry args={[0.34, 0.06, 0.24]} />
        </mesh>
      ))}

      {/* ---------------- wall dressing ---------------- */}
      <Shield pos={[-6.2, 2.3, -1.4]} rot={[0, Math.PI / 2, 0]} color="#4a2f22" />
      <Shield pos={[-6.2, 2.3, 1.6]} rot={[0, Math.PI / 2, 0]} color="#26404a" />
      <Shield pos={[6.2, 2.3, 0.4]} rot={[0, -Math.PI / 2, 0]} color="#3d2a44" />
      <Shield pos={[-2.2, 2.5, -4.72]} rot={[0, 0, 0]} color="#5a3a1c" />
      <Shield pos={[2.2, 2.5, -4.72]} rot={[0, 0, 0]} color="#2f4230" />
      <Axe pos={[-6.28, 2.0, 2.9]} rot={[0, 0, 0.22]} />
      <Axe pos={[-6.28, 1.5, 3.5]} rot={[0, 0, 0.28]} />
      <Sword pos={[6.28, 2.0, -3.0]} rot={[0, 0, 0.14]} />
      <Barrel pos={[-5.4, 0.43, 3.4]} />
      <Barrel pos={[-4.7, 0.43, 4.0]} />
      <Barrel pos={[5.6, 0.43, 3.6]} />
      {/* fur rugs */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-1.9, 0.012, -3.0]} material={MATS.furWhite}>
        <circleGeometry args={[1.5, 16]} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0.3]} position={[3.4, 0.012, 3.4]} material={MATS.furDark}>
        <circleGeometry args={[1.1, 14]} />
      </mesh>
      {/* side table with candles */}
      <group position={[-5.6, 0, -1.2]}>
        <mesh position={[0, 0.75, 0]} material={MATS.oak}>
          <boxGeometry args={[1.5, 0.08, 0.7]} />
        </mesh>
        {[-0.6, 0.6].map((x) => (
          <mesh key={x} position={[x, 0.37, 0]} material={MATS.darkOak}>
            <boxGeometry args={[0.1, 0.75, 0.1]} />
          </mesh>
        ))}
        <Candle pos={[-0.4, 0.79, 0]} />
        <Candle pos={[0.35, 0.79, 0.1]} />
      </group>
      <group position={[5.6, 0, 1.6]}>
        <mesh position={[0, 0.72, 0]} material={MATS.oak}>
          <cylinderGeometry args={[0.5, 0.42, 0.08, 14]} />
        </mesh>
        <mesh position={[0, 0.36, 0]} material={MATS.darkOak}>
          <cylinderGeometry args={[0.1, 0.14, 0.72, 10]} />
        </mesh>
        <Candle pos={[0.2, 0.76, 0.1]} />
      </group>
      <Fireplace />

      {/* ---------------- lighting ---------------- */}
      <ambientLight intensity={0.16} color="#ffd9ac" />
      <hemisphereLight args={["#4a6285", "#2a1a10", 0.32]} />
      <directionalLight position={[-2, 4, -14]} intensity={0.55} color="#8fb6e6" />
      {/* hanging lanterns over the table */}
      {[-1.5, 1.5].map((x, i) => (
        <group key={x} position={[x, 3.0, 0]}>
          <mesh position={[0, 0.7, 0]} material={MATS.iron}>
            <cylinderGeometry args={[0.01, 0.01, 1.4, 6]} />
          </mesh>
          <mesh material={MATS.iron}>
            <boxGeometry args={[0.2, 0.26, 0.2]} />
          </mesh>
          <mesh>
            <boxGeometry args={[0.15, 0.2, 0.15]} />
            <meshBasicMaterial color="#ffcf8a" />
          </mesh>
          <pointLight
            ref={i === 0 ? lanternA : lanternB}
            position={[0, -0.05, 0]}
            color="#ffc078"
            intensity={1.5}
            distance={7.5}
            decay={2}
          />
        </group>
      ))}
      {/* table spotlight — the single shadow caster */}
      <spotLight
        position={[0, 3.5, 0.15]}
        angle={0.72}
        penumbra={0.8}
        intensity={quality === "low" ? 22 : 34}
        distance={9}
        decay={1.5}
        color="#ffe3b8"
        castShadow={quality !== "low"}
        shadow-mapSize-width={quality === "high" ? 1024 : 512}
        shadow-mapSize-height={quality === "high" ? 1024 : 512}
        shadow-bias={-0.0006}
        shadow-camera-near={0.6}
        shadow-camera-far={6}
      />
      <Village />
      <Snowfall count={quality === "low" ? 200 : 420} />
    </group>
  );
}
