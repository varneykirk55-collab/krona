/**
 * KRONA — the carved oak poker table and the Viking chairs around it.
 */
import { useMemo } from "react";
import * as THREE from "three";
import { MATS, stadiumGeometry, stadiumRingGeometry } from "./materials";
import { TABLE, seatPos, feltPoint } from "../game/view";

export function PokerTable() {
  const feltGeo = useMemo(() => stadiumGeometry(TABLE.rx, TABLE.rz, 0.06), []);
  const skirtGeo = useMemo(() => stadiumGeometry(TABLE.rx + 0.04, TABLE.rz + 0.04, 0.14), []);
  const railGeo = useMemo(
    () => stadiumRingGeometry(TABLE.railRx, TABLE.railRz, TABLE.rx + 0.02, TABLE.rz - 0.02, 0.19, 0.055, 30),
    []
  );
  const bandGeo = useMemo(
    () => stadiumRingGeometry(TABLE.railRx + 0.14, TABLE.railRz + 0.14, TABLE.railRx, TABLE.railRz, 0.23, 0.03, 30),
    []
  );

  const studs = useMemo(() => {
    const out: [number, number, number][] = [];
    const N = 26;
    for (let i = 0; i < N; i++) {
      const a = (i / N) * Math.PI * 2;
      out.push([Math.sin(a) * (TABLE.railRx + 0.075), TABLE.railY - 0.02, Math.cos(a) * (TABLE.railRz + 0.075)]);
    }
    return out;
  }, []);

  return (
    <group>
      {/* playing surface */}
      <mesh geometry={feltGeo} material={MATS.felt} position={[0, TABLE.feltY - 0.06, 0]} receiveShadow>
        <primitive object={feltGeo} attach="geometry" />
      </mesh>
      {/* skirt / carcass */}
      <mesh geometry={skirtGeo} material={MATS.darkOak} position={[0, TABLE.feltY - 0.2, 0]} castShadow receiveShadow />
      {/* padded leather armrest */}
      <mesh geometry={railGeo} material={MATS.leather} position={[0, TABLE.railY - 0.2, 0]} castShadow receiveShadow />
      {/* carved oak outer band */}
      <mesh geometry={bandGeo} material={MATS.oak} position={[0, TABLE.railY - 0.21, 0]} castShadow receiveShadow />
      {/* brass studs */}
      {studs.map((p, i) => (
        <mesh key={i} position={p} material={MATS.brass}>
          <sphereGeometry args={[0.018, 8, 6]} />
        </mesh>
      ))}
      {/* brass corner fittings: thin trim arcs hugging the rounded end caps
          of the rail band. Each half-torus is centred on its cap circle
          (x = ±(railRx - railRz), z = 0) and yawed so the semicircle bulges
          outward along ±X, sitting proud of the band's outer wall. */}
      {[-1, 1].map((s) => (
        <group
          key={s}
          position={[s * (TABLE.railRx - TABLE.railRz), 0.8, 0]}
          rotation={[0, (s * Math.PI) / 2, 0]}
        >
          <mesh rotation={[Math.PI / 2, 0, 0]} material={MATS.brass}>
            <torusGeometry args={[TABLE.railRz + 0.17, 0.012, 6, 22, Math.PI]} />
          </mesh>
        </group>
      ))}

      {/* heavy carved base */}
      <group position={[0, 0, 0]}>
        <mesh position={[0, 0.42, 0]} material={MATS.darkOak} castShadow receiveShadow>
          <cylinderGeometry args={[0.42, 0.56, 0.5, 16]} />
        </mesh>
        {/* top ends at y=0.70, tucked under the felt (felt underside 0.72) */}
        <mesh position={[0, 0.54, 0]} material={MATS.oak} castShadow receiveShadow>
          <cylinderGeometry args={[0.24, 0.42, 0.32, 16]} />
        </mesh>
        <mesh position={[0, 0.2, 0]} material={MATS.darkOak} castShadow receiveShadow>
          <cylinderGeometry args={[0.95, 1.05, 0.18, 20]} />
        </mesh>
        {[0, 1, 2, 3].map((i) => {
          const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
          return (
            <group key={i} position={[Math.sin(a) * 0.72, 0.3, Math.cos(a) * 0.72]} rotation={[0, -a, 0]}>
              <mesh material={MATS.oak} castShadow receiveShadow>
                <boxGeometry args={[0.18, 0.6, 0.24]} />
              </mesh>
              <mesh position={[0, 0.24, 0.12]} material={MATS.brass}>
                <boxGeometry args={[0.14, 0.1, 0.02]} />
              </mesh>
              <mesh position={[0, -0.24, 0.12]} material={MATS.brass}>
                <boxGeometry args={[0.14, 0.1, 0.02]} />
              </mesh>
            </group>
          );
        })}
        {/* carved rune ring on the column (flat, wrapped around the column;
            column radius at y=0.46 is ~0.48) */}
        <mesh position={[0, 0.46, 0]} rotation={[Math.PI / 2, 0, 0]} material={MATS.brass}>
          <torusGeometry args={[0.48, 0.014, 6, 24]} />
        </mesh>
      </group>

      {/* dealer chip tray carved into the rail */}
      <group position={[deckTray.x, TABLE.railY - 0.06, deckTray.z]}>
        <mesh material={MATS.darkOak}>
          <boxGeometry args={[0.34, 0.06, 0.26]} />
        </mesh>
        <mesh material={MATS.leather} position={[0, 0.02, 0]}>
          <boxGeometry args={[0.3, 0.03, 0.22]} />
        </mesh>
      </group>
    </group>
  );
}

/** tray sits in the rail near the far side of the table */
const deckTray = { x: -(TABLE.rx - TABLE.rz) - 0.55, z: 0.34 };

/* ------------------------------------------------------------------ */
/* chairs                                                             */
/* ------------------------------------------------------------------ */

export function Chair({ seatIndex }: { seatIndex: number }) {
  const p = seatPos(seatIndex);
  const facing = Math.atan2(-p.x, -p.z);
  const fur = seatIndex % 2 === 0 ? MATS.furDark : MATS.furWhite;
  return (
    <group position={[p.x, 0, p.z]} rotation={[0, facing, 0]}>
      {/* seat */}
      <mesh position={[0, 0.46, 0]} material={MATS.oak} castShadow receiveShadow>
        <boxGeometry args={[0.62, 0.08, 0.58]} />
      </mesh>
      <mesh position={[0, 0.52, 0]} material={fur}>
        <boxGeometry args={[0.56, 0.05, 0.52]} />
      </mesh>
      {/* thick legs */}
      {[
        [-0.26, -0.24],
        [0.26, -0.24],
        [-0.26, 0.24],
        [0.26, 0.24],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.23, z]} material={MATS.darkOak} castShadow>
          <boxGeometry args={[0.09, 0.46, 0.09]} />
        </mesh>
      ))}
      {/* side rails */}
      {[-1, 1].map((s) => (
        <mesh key={s} position={[s * 0.27, 0.28, 0]} material={MATS.oak}>
          <boxGeometry args={[0.07, 0.07, 0.5]} />
        </mesh>
      ))}
      {/* high carved backrest (behind the sitter, away from the table) */}
      <mesh position={[0, 0.9, -0.3]} material={MATS.oak} castShadow>
        <boxGeometry args={[0.62, 0.82, 0.09]} />
      </mesh>
      <mesh position={[0, 0.92, -0.24]} material={fur}>
        <boxGeometry args={[0.52, 0.66, 0.06]} />
      </mesh>
      {/* carved crest */}
      <mesh position={[0, 1.36, -0.3]} material={MATS.darkOak} castShadow>
        <boxGeometry args={[0.7, 0.12, 0.12]} />
      </mesh>
      <mesh position={[0, 1.5, -0.31]} material={MATS.brass}>
        <torusGeometry args={[0.1, 0.014, 6, 14]} />
      </mesh>
      <mesh position={[0, 1.5, -0.32]} material={MATS.brass}>
        <sphereGeometry args={[0.03, 8, 6]} />
      </mesh>
      {/* uprights with finials */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 0.27, 1.0, -0.3]}>
          <mesh material={MATS.darkOak} castShadow>
            <boxGeometry args={[0.08, 1.1, 0.08]} />
          </mesh>
          <mesh position={[0, 0.6, 0]} material={MATS.oak}>
            <sphereGeometry args={[0.05, 10, 8]} />
          </mesh>
        </group>
      ))}
      {/* armrests */}
      {[-1, 1].map((s) => (
        <group key={s} position={[s * 0.31, 0.64, 0.04]}>
          <mesh material={MATS.oak} castShadow>
            <boxGeometry args={[0.07, 0.05, 0.44]} />
          </mesh>
          <mesh position={[0, -0.13, 0.19]} material={MATS.darkOak}>
            <boxGeometry args={[0.06, 0.26, 0.06]} />
          </mesh>
        </group>
      ))}
      {/* carved knotwork panel on the back */}
      <mesh position={[0, 1.06, -0.36]} rotation={[0, Math.PI, 0]}>
        <planeGeometry args={[0.34, 0.12]} />
        <meshStandardMaterial color="#c9a341" roughness={0.4} metalness={0.5} />
      </mesh>
    </group>
  );
}

/** soft contact shadow used under each seated figure */
export function SeatShadow({ seatIndex }: { seatIndex: number }) {
  const p = feltPoint(seatIndex, -0.06);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[p.x, 0.006, p.z]}>
      <circleGeometry args={[0.42, 18]} />
      <meshBasicMaterial color="#000000" transparent opacity={0.28} depthWrite={false} />
    </mesh>
  );
}

export function chairForward(seatIndex: number) {
  const p = seatPos(seatIndex);
  return new THREE.Vector3(-p.x, 0, -p.z).normalize();
}
