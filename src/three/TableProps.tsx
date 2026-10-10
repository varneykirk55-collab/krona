/**
 * KRONA — table props: physical cards, chips, the dealer button and the
 * player's own first-person hands.
 *
 * Everything is driven from the ViewModel each frame (no React re-renders
 * during play) and chips are drawn with one InstancedMesh per denomination.
 */
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, useThree } from "@react-three/fiber";
import { MATS, CARD_T, cardBodyGeo, cardFaceGeo, cardFaceMat, chipGeo, CHIP_MATS, buttonGeo, buttonMats } from "./materials";
import { CardVisual, ChipStackVisual, TABLE, betSlot, chipBreakdown, feltPoint, seatPos } from "../game/view";
import { game } from "../game/controller";

const MAX_CARDS = 40;
const MAX_CHIPS = 90;

/** screen-space label anchors, read by the DOM overlay */
export const labelState: { x: number; y: number; visible: boolean }[] = Array.from({ length: 8 }, () => ({
  x: -999,
  y: -999,
  visible: false,
}));

/* ------------------------------------------------------------------ */
/* cards                                                              */
/* ------------------------------------------------------------------ */

interface Slot {
  group: THREE.Group;
  body: THREE.Mesh;
  face: THREE.Mesh;
  back: THREE.Mesh;
  uid: string | null;
  pos: THREE.Vector3;
  rot: THREE.Euler;
}

function makeCardSlot(): Slot {
  const group = new THREE.Group();
  const body = new THREE.Mesh(cardBodyGeo, MATS.cardEdge);
  const face = new THREE.Mesh(cardFaceGeo, MATS.cardEdge);
  face.rotation.x = -Math.PI / 2;
  face.position.y = CARD_T * 0.5 + 0.00015;
  const back = new THREE.Mesh(cardFaceGeo, MATS.cardBack);
  back.rotation.x = Math.PI / 2;
  back.position.y = -CARD_T * 0.5 - 0.00015;
  group.add(body, face, back);
  return { group, body, face, back, uid: null, pos: new THREE.Vector3(), rot: new THREE.Euler() };
}

export function Cards() {
  const slots = useMemo(() => Array.from({ length: MAX_CARDS }, () => makeCardSlot()), []);
  const root = useRef<THREE.Group>(null);
  const tmp = useMemo(() => new THREE.Vector3(), []);

  useMemo(() => {
    // attach to the scene once
    const g = new THREE.Group();
    slots.forEach((s) => g.add(s.group));
    return g;
  }, [slots]);

  useFrame((_, dt) => {
    const view = game.view;
    view.tick(dt);
    const cards = view.cards;
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const cv = cards[i] as CardVisual | undefined;
      if (!cv || !cv.card) {
        slot.group.visible = false;
        slot.uid = null;
        continue;
      }
      slot.group.visible = true;
      if (slot.uid !== cv.uid) {
        slot.uid = cv.uid;
        slot.face.material = cardFaceMat(cv.card.id);
        slot.pos.set(cv.pos.x, cv.pos.y, cv.pos.z);
        slot.rot.set(cv.rot.x, cv.rot.y, cv.rot.z);
      }
      const peeking = cv.holder === 0 && view.peek > 0.02;
      let tx = cv.target.x;
      let ty = cv.target.y;
      let tz = cv.target.z;
      let rx = cv.targetRot.x;
      const ry = cv.targetRot.y;
      let rz = cv.targetRot.z;
      let flip = cv.faceUp ? 0 : Math.PI;
      if (peeking) {
        const k = view.peek;
        ty += 0.26 * k;
        tz += 0.16 * k;
        tx += (cv.slot === 0 ? -0.012 : 0.012) * k;
        rx = -0.62 * k;
        flip = k > 0.45 ? 0 : Math.PI;
        rz = (cv.slot === 0 ? 0.05 : -0.05) * k;
      } else if (cv.holder === 0) {
        // rest slightly angled so they read as two distinct cards
        rx = 0;
      }
      const k = Math.min(1, dt * 8.5);
      slot.pos.lerp(tmp.set(tx, ty, tz), k);
      slot.rot.x += (rx - slot.rot.x) * k;
      slot.rot.y += (ry - slot.rot.y) * k;
      slot.rot.z += (rz + flip - slot.rot.z) * k;
      slot.group.position.copy(slot.pos);
      slot.group.rotation.copy(slot.rot);
      slot.group.visible = true;
    }
    void root;
  });

  return (
    <group>
      {slots.map((s, i) => (
        <primitive key={i} object={s.group} />
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* chips                                                              */
/* ------------------------------------------------------------------ */

export function ChipField() {
  const meshes = useRef<(THREE.InstancedMesh | null)[]>([]);
  const layout = useMemo(() => new Map<string, { amount: number; cols: { d: number; y: number; x: number; z: number }[] }>(), []);
  const m4 = useMemo(() => new THREE.Matrix4(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  const scale = useMemo(() => new THREE.Vector3(1, 1, 1), []);
  const pos = useMemo(() => new THREE.Vector3(), []);

  useFrame(() => {
    const view = game.view;
    const counts = new Array(CHIP_MATS.length).fill(0);
    const place = (denomIdx: number, x: number, y: number, z: number) => {
      const im = meshes.current[denomIdx];
      if (!im || counts[denomIdx] >= MAX_CHIPS) return;
      pos.set(x, y, z);
      m4.compose(pos, q, scale);
      im.setMatrixAt(counts[denomIdx], m4);
      counts[denomIdx]++;
    };

    for (const stack of view.stacks) {
      let l = layout.get(stack.id);
      if (!l || l.amount !== stack.amount) {
        const bd = chipBreakdown(stack.amount, stack.base);
        const cols: { d: number; y: number; x: number; z: number }[] = [];
        let ci = 0;
        for (const g of bd) {
          for (let i = 0; i < g.count; i++) {
            if (i > 0 && i % 8 === 0) ci++;
            const col = ci;
            const row = i % 8;
            const ox = Math.cos(col * 1.05) * 0.026 * col;
            const oz = Math.sin(col * 1.05) * 0.026 * col;
            cols.push({ d: g.denom, y: row * 0.0038, x: ox, z: oz });
          }
          ci++;
        }
        l = { amount: stack.amount, cols };
        layout.set(stack.id, l);
      }
      // stack origin
      const ox = stack.pos.x;
      const oz = stack.pos.z;
      for (const c of l.cols) {
        place(c.d, ox + c.x, TABLE.feltY + 0.0018 + c.y, oz + c.z);
      }
      // in-flight chips (bets sliding in, pots being pushed)
      for (const f of stack.flights) {
        const p = f.progress ?? 0;
        const t = Math.min(1, Math.max(0, p));
        const x = f.pos.x + (f.target.x - f.pos.x) * t;
        const z = f.pos.z + (f.target.z - f.pos.z) * t;
        const y = f.pos.y + (f.target.y - f.pos.y) * t + Math.sin(t * Math.PI) * 0.06;
        const d = l.cols.length ? l.cols[Math.floor(l.cols.length / 2)].d : 0;
        place(d, x, y, z);
      }
    }

    for (let i = 0; i < CHIP_MATS.length; i++) {
      const im = meshes.current[i];
      if (!im) continue;
      im.count = counts[i];
      im.instanceMatrix.needsUpdate = true;
    }
  });

  return (
    <group>
      {CHIP_MATS.map((mats, i) => (
        <instancedMesh
          key={i}
          ref={(r) => {
            meshes.current[i] = r;
          }}
          args={[chipGeo, mats as unknown as THREE.Material, MAX_CHIPS]}
          castShadow
          frustumCulled={false}
        />
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* dealer button + labels                                             */
/* ------------------------------------------------------------------ */

export function DealerButton() {
  const ref = useRef<THREE.Mesh>(null);
  const target = useMemo(() => new THREE.Vector3(), []);
  useFrame((_, dt) => {
    if (!ref.current) return;
    const d = game.engine?.state.dealer ?? game.dealer;
    const p = feltPoint(d, 0.52);
    target.set(p.x, TABLE.feltY + 0.004, p.z);
    ref.current.position.lerp(target, Math.min(1, dt * 6));
  });
  return <mesh ref={ref} geometry={buttonGeo} material={buttonMats as unknown as THREE.Material} castShadow />;
}

export function SeatLabelProjector() {
    const { camera, size } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    for (let i = 0; i < 8; i++) {
      const seat = game.engine?.state.seats[i] ?? game.seats[i];
      const l = labelState[i];
      if (!seat) {
        l.visible = false;
        continue;
      }
      const p = seatPos(i);
      v.set(p.x * 0.86, 1.62, p.z * 0.86);
      v.project(camera);
      l.x = ((v.x + 1) / 2) * size.width;
      l.y = ((1 - v.y) / 2) * size.height;
      l.visible = v.z < 1 && Math.abs(v.x) < 1.25 && Math.abs(v.y) < 1.25;
    }
  });
  return null;
}

/* ------------------------------------------------------------------ */
/* first person hands                                                 */
/* ------------------------------------------------------------------ */

function Hand({ side }: { side: -1 | 1 }) {
  const palm = useMemo(() => new THREE.CapsuleGeometry(0.036, 0.055, 4, 10), []);
  const finger = useMemo(() => new THREE.CapsuleGeometry(0.0105, 0.036, 3, 8), []);
  const thumb = useMemo(() => new THREE.CapsuleGeometry(0.013, 0.03, 3, 8), []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ color: "#c08a5e", roughness: 0.62 }), []);
  return (
    <group scale={[side, 1, 1]}>
      <mesh geometry={palm} material={mat} rotation={[Math.PI / 2, 0, 0]} />
      {[-0.028, -0.011, 0.006, 0.023].map((x, i) => (
        <group key={x} position={[x, 0.004, 0.055]} rotation={[-0.28 - i * 0.05, 0, 0]}>
          <mesh geometry={finger} material={mat} position={[0, 0, 0.022]} rotation={[Math.PI / 2, 0, 0]} />
          <mesh geometry={finger} material={mat} position={[0, 0, 0.058]} rotation={[Math.PI / 2 - 0.35 - i * 0.12, 0, 0]} />
        </group>
      ))}
      <group position={[0.04 * side, 0, 0.005]} rotation={[0.2, 0, -0.9 * side]}>
        <mesh geometry={thumb} material={mat} position={[0.02, 0, 0]} rotation={[0, 0, Math.PI / 2]} />
      </group>
      {/* sleeve */}
      <mesh position={[0, -0.01, -0.07]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.042, 0.05, 0.12, 12]} />
        <meshStandardMaterial color="#3f3122" roughness={0.85} />
      </mesh>
    </group>
  );
}

export function FirstPersonHands() {
  const { camera } = useThree();
  const left = useRef<THREE.Group>(null);
  const right = useRef<THREE.Group>(null);
  const base = useMemo(() => new THREE.Vector3(), []);
  const q = useMemo(() => new THREE.Quaternion(), []);
  useFrame((state, dt) => {
    const view = game.view;
    const t = state.clock.elapsedTime;
    const peek = view.peek;
    const ha = view.handAction;
    const dealer = game.engine?.state.dealer ?? -1;
    let rightTarget = new THREE.Vector3(0.3, -0.34, -0.52);
    let leftTarget = new THREE.Vector3(-0.3, -0.36, -0.5);
    let rRot = 0.2;
    let lRot = -0.2;
    if (peek > 0.02) {
      rightTarget.set(0.13, -0.28 - peek * 0.02, -0.44 + peek * 0.06);
      leftTarget.set(-0.14, -0.29 - peek * 0.02, -0.42 + peek * 0.06);
      rRot = 0.9 * peek;
      lRot = -0.9 * peek;
    }
    if (ha && performance.now() - ha.t < 900) {
      if (ha.kind === "deal" && dealer === 0) {
        const k = Math.sin(Math.min(1, (performance.now() - ha.t) / 900) * Math.PI);
        rightTarget.set(0.12, -0.2 - k * 0.05, -0.3 - k * 0.16);
      } else if (ha.kind === "chips" && ha.seat === 0) {
        const k = Math.sin(Math.min(1, (performance.now() - ha.t) / 900) * Math.PI);
        rightTarget.set(0.16, -0.22, -0.32 - k * 0.1);
        leftTarget.set(-0.2, -0.3, -0.36 - k * 0.06);
      }
    }
    const sway = Math.sin(t * 0.7) * 0.006;
    for (const [ref, target, rot] of [
      [right, rightTarget, rRot],
      [left, leftTarget, lRot],
    ] as const) {
      if (!ref.current) continue;
      base.copy(target);
      base.applyMatrix4(camera.matrixWorld);
      ref.current.position.lerp(base, Math.min(1, dt * 7));
      q.copy(camera.quaternion);
      ref.current.quaternion.slerp(q, Math.min(1, dt * 7));
      ref.current.rotateY(rot);
      ref.current.position.y += sway * (ref === left ? -1 : 1);
    }
  });
  return (
    <group>
      <group ref={right}>
        <Hand side={1} />
      </group>
      <group ref={left}>
        <Hand side={-1} />
      </group>
    </group>
  );
}

/** helper for the UI: chip stack anchor for a seat */
export function seatStackAnchor(seat: number) {
  const p = betSlot(seat);
  return p;
}

export function stackOf(seat: number): ChipStackVisual | undefined {
  return game.view.stacks.find((s) => s.seat === seat);
}
