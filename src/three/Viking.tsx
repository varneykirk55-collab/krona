/**
 * KRONA — rigged Viking characters.
 *
 * Every character is a genuine articulated 3D figure: a hierarchy of joint
 * Object3Ds (hips > spine > chest > neck > head, plus two three-joint arms
 * and two two-joint legs) with limb meshes parented to each joint. Poses are
 * driven procedurally so the same rig deals, checks cards, bets and folds.
 */
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame } from "@react-three/fiber";
import { CastMember, CLOAK_COLORS, HAIR_COLORS, SKIN_COLORS, TUNIC_COLORS } from "../game/config";
import { seatPos } from "../game/view";
import { game } from "../game/controller";
import { knotPattern } from "./textures";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { handGeometry, taperedCapsule } from "./proceduralHands";

/** proportions for a ~1.70 m figure (local units are metres) */
const G = {
  torso: new THREE.CapsuleGeometry(0.17, 0.26, 4, 12),
  waist: new THREE.CapsuleGeometry(0.155, 0.1, 4, 10),
  neck: new THREE.CapsuleGeometry(0.05, 0.08, 4, 10),
  head: new THREE.SphereGeometry(0.105, 16, 14),
  jaw: new THREE.SphereGeometry(0.084, 12, 10),
  nose: new THREE.ConeGeometry(0.019, 0.05, 8),
  ear: new THREE.SphereGeometry(0.024, 8, 6),
  eye: new THREE.SphereGeometry(0.014, 10, 8),
  brow: new THREE.CapsuleGeometry(0.008, 0.03, 3, 6),
  hairCap: new THREE.SphereGeometry(0.116, 14, 12, 0, Math.PI * 2, 0, Math.PI * 0.62),
  braid: new THREE.CapsuleGeometry(0.024, 0.15, 4, 8),
  beard: new THREE.SphereGeometry(0.092, 12, 10),
  upperArm: taperedCapsule(0.056, 0.22, 0.82),
  forearm: taperedCapsule(0.047, 0.22, 0.64),
  handL: handGeometry(1),
  handR: handGeometry(-1),
  thigh: taperedCapsule(0.086, 0.3, 0.8),
  shin: taperedCapsule(0.066, 0.3, 0.7),
  foot: new RoundedBoxGeometry(0.09, 0.05, 0.22, 3, 0.012),
  shoulder: new THREE.SphereGeometry(0.076, 10, 8),
  skirt: new THREE.CylinderGeometry(0.2, 0.26, 0.3, 14, 1, true),
  cloak: new THREE.CylinderGeometry(0.21, 0.34, 0.66, 14, 1, true, Math.PI * 0.15, Math.PI * 1.5),
  belt: new THREE.TorusGeometry(0.17, 0.018, 6, 18),
  torc: new THREE.TorusGeometry(0.078, 0.012, 6, 16),
  armring: new THREE.TorusGeometry(0.052, 0.009, 6, 14),
};

const knotMap = knotPattern([3, 1]);

function Mat(color: string, rough = 0.72, metal = 0.02, map?: THREE.Texture | null) {
  return new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal, map: map ?? null });
}

type Joint = React.MutableRefObject<THREE.Group | null>;

/** every animated channel of the rig, in radians */
interface Pose {
  lean: number;
  roll: number;
  twist: number;
  headPitch: number;
  headYaw: number;
  headRoll: number;
  shL: number;
  shR: number;
  elL: number;
  elR: number;
  outL: number;
  outR: number;
  legL: number;
  legR: number;
  spreadL: number;
  spreadR: number;
  kneeL: number;
  kneeR: number;
}

const SEATED: Pose = {
  lean: 0.06,
  roll: 0,
  twist: 0,
  headPitch: 0.22,
  headYaw: 0,
  headRoll: 0,
  shL: -0.95,
  shR: -0.95,
  elL: -0.55,
  elR: -0.55,
  outL: 0.22,
  outR: -0.22,
  legL: -1.5,
  legR: -1.5,
  spreadL: 0.06,
  spreadR: -0.06,
  kneeL: 1.45,
  kneeR: 1.45,
};

/** folded players sit back (lean drops by 0.16) with their arms in their lap */
const FOLDED: Partial<Pose> = { headPitch: 0.05, shL: -0.35, shR: -0.35, elL: -0.2, elR: -0.2 };

const KEYS = Object.keys(SEATED) as (keyof Pose)[];

/** spring stiffness per channel: heads are quick, torso and legs are heavy */
const OMEGA: Record<keyof Pose, number> = {
  lean: 6, roll: 4, twist: 5,
  headPitch: 10, headYaw: 11, headRoll: 8,
  shL: 9, shR: 9, elL: 10, elR: 10, outL: 8, outR: 8,
  legL: 3.5, legR: 3.5, spreadL: 3.5, spreadR: 3.5, kneeL: 3.5, kneeR: 3.5,
};

const SHOULDER_Y = 0.07;

type GestureKind = "peek" | "deal" | "chips" | "check" | "think";

/** s is a 0..1..0 bell over the gesture; phase runs 0..1 */
const GESTURES: Record<GestureKind, { dur: number; pose: (p: Pose, s: number, phase: number) => Partial<Pose> }> = {
  peek: {
    dur: 2.2,
    pose: (p, s) => ({ lean: p.lean + s * 0.2, headPitch: p.headPitch + s * 0.45, headYaw: p.headYaw * 0.3, shL: -1.25, shR: -1.3, elL: -1.15, elR: -1.2 }),
  },
  deal: {
    dur: 1.5,
    pose: (p, s) => ({ lean: p.lean + s * 0.08, headPitch: p.headPitch + s * 0.08, shR: -1.5 + s * 0.2, elR: -0.25 - s * 0.1, outR: -0.12 - s * 0.06 }),
  },
  chips: {
    dur: 1.6,
    pose: (p, s) => ({ lean: p.lean + s * 0.06, headPitch: p.headPitch + s * 0.1, shR: -1.1 - s * 0.25, elR: -0.7 - s * 0.35 }),
  },
  check: {
    // two knuckle raps on the table
    dur: 1.2,
    pose: (p, _s, phase) => ({ shR: -1.15, elR: -0.9 + Math.max(0, Math.sin(phase * Math.PI * 4)) * 0.45, headPitch: p.headPitch + 0.06 }),
  },
  think: {
    // hand to the chin, head cocked
    dur: 2.8,
    pose: (p, s) => ({ headYaw: p.headYaw + s * 0.32, headPitch: p.headPitch + s * 0.12, headRoll: s * 0.07, shL: -1.2, elL: -1.4 }),
  },
};

interface Layer {
  kind: GestureKind;
  start: number;
  release: number;
}

function smooth01(x: number) {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
}

/** layer weight: eased in and out, and faded early if a newer gesture took over */
function layerWeight(l: Layer, t: number) {
  const dur = GESTURES[l.kind].dur;
  const gt = t - l.start;
  let w = smooth01(gt / 0.28) * (1 - smooth01((gt - (dur - 0.4)) / 0.4));
  if (l.release >= 0) w *= 1 - smooth01((t - l.release) / 0.32);
  return w;
}

/** critically damped spring, stable at any frame time */
function damp(x: number, v: number, target: number, omega: number, dt: number): [number, number] {
  const o = omega * dt;
  const e = 1 / (1 + o + 0.48 * o * o + 0.235 * o * o * o);
  const change = x - target;
  const temp = (v + omega * change) * dt;
  return [target + (change + temp) * e, (v - omega * temp) * e];
}

/** asymmetric breath: quicker inhale, longer exhale, 0..1 */
function breathCurve(phase: number) {
  const x = phase - Math.floor(phase);
  return x < 0.4 ? smooth01(x / 0.4) : 1 - smooth01((x - 0.4) / 0.6);
}

function wrapAngle(a: number) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

export function Viking({ seatIndex, cast }: { seatIndex: number; cast: CastMember }) {
  const p = seatPos(seatIndex);
  const facing = Math.atan2(-p.x, -p.z);

  const M = useMemo(() => {
    const tunicCol = TUNIC_COLORS[cast.tunic % TUNIC_COLORS.length];
    const cloakCol = CLOAK_COLORS[cast.cloak % CLOAK_COLORS.length];
    return {
      skin: Mat(SKIN_COLORS[cast.skin % SKIN_COLORS.length], 0.66),
      tunic: Mat(tunicCol, 0.86, 0.02, cast.gender === "f" ? knotMap : null),
      cloak: Mat(cloakCol, 0.9),
      hair: Mat(HAIR_COLORS[cast.hair % HAIR_COLORS.length], 0.72),
      leather: Mat("#3b2a1e", 0.62, 0.04),
      brass: Mat("#c9a341", 0.32, 0.9),
      iron: Mat("#4a4d52", 0.45, 0.8),
      eye: Mat("#1b1a1c", 0.3, 0.1),
    };
  }, [cast]);

  const scale = useMemo(() => {
    const h = 0.94 + cast.height * 0.11;
    const b = 0.95 + cast.build * 0.13;
    return new THREE.Vector3(h * (0.88 + b * 0.14), h, h * (0.92 + b * 0.1));
  }, [cast]);

  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const spine = useRef<THREE.Group>(null);
  const chest = useRef<THREE.Group>(null);
  const neck = useRef<THREE.Group>(null);
  const head = useRef<THREE.Group>(null);
  const shL = useRef<THREE.Group>(null);
  const shR = useRef<THREE.Group>(null);
  const elL = useRef<THREE.Group>(null);
  const elR = useRef<THREE.Group>(null);
  const thL = useRef<THREE.Group>(null);
  const thR = useRef<THREE.Group>(null);
  const knL = useRef<THREE.Group>(null);
  const knR = useRef<THREE.Group>(null);
  const eyeL = useRef<THREE.Mesh>(null);
  const eyeR = useRef<THREE.Mesh>(null);

  const anim = useRef({
    seed: Math.random() * 100,
    dealt: 0,
    checkAt: 0,
    lastHa: -1,
    lastActor: -1,
    layers: [] as Layer[],
    cur: { ...SEATED } as Pose,
    vel: Object.fromEntries(KEYS.map((k) => [k, 0])) as unknown as Pose,
    folded: false,
    foldW: 0,
    // breathing: per-character rate, phase accumulates so rate changes never jump
    breathRate: rand(0.19, 0.26),
    breathPhase: Math.random(),
    // weight shifts: an offset pose eased slowly toward a new random target
    shiftAt: rand(2, 7),
    shift: {} as Partial<Pose>,
    shiftCur: {} as Partial<Pose>,
    // gaze: where the head is looking until gazeUntil, then back to the table
    gazeYaw: 0,
    gazePitch: 0,
    gazeUntil: 0,
    nextGlance: rand(2, 6),
    blinkAt: rand(1, 5),
  });

  useFrame((state, dt) => {
    const a = anim.current;
    const t = state.clock.elapsedTime + a.seed;
    const now = performance.now();

    const startGesture = (kind: GestureKind) => {
      for (const l of a.layers) if (l.release < 0) l.release = t;
      a.layers.push({ kind, start: t, release: -1 });
    };
    const lookAt = (x: number, z: number, pitch: number, hold: number) => {
      const yaw = THREE.MathUtils.clamp(wrapAngle(Math.atan2(x - p.x, z - p.z) - facing), -1.05, 1.05);
      if (Math.abs(yaw - a.gazeYaw) > 0.4) a.blinkAt = t;
      a.gazeYaw = yaw;
      a.gazePitch = pitch;
      a.gazeUntil = t + hold;
    };
    const lookAtSeat = (j: number, hold: number) => {
      const q = seatPos(j);
      lookAt(q.x, q.z, j === 0 ? -0.02 : 0.04, hold);
    };

    // ---- read public game state (cheap, throttled) ----
    if (now - a.checkAt > 220) {
      a.checkAt = now;
      const v = game.view;
      const mine = v.cards.filter((c) => c.holder === seatIndex).length;
      if (mine > a.dealt) {
        a.dealt = mine;
        startGesture("peek");
      } else if (mine < a.dealt) a.dealt = mine;
      const ha = v.handAction;
      if (ha && ha.t !== a.lastHa) {
        a.lastHa = ha.t;
        if (ha.seat === seatIndex) {
          if (ha.kind === "fold") a.folded = true;
          else if (ha.kind === "check") startGesture("check");
          else if (ha.kind === "chips") startGesture("chips");
          else if (ha.kind === "deal" || ha.kind === "deal-self") startGesture("deal");
          else if (ha.kind === "think") startGesture("think");
          if (ha.kind !== "fold") a.folded = false;
        } else if (ha.kind !== "deal" && ha.kind !== "deal-self" && Math.random() < 0.6) {
          // someone else bet, checked or folded: most of the table looks over
          lookAtSeat(ha.seat, rand(0.9, 1.8));
        }
      }
      const st = game.engine?.state;
      const seat = st?.seats[seatIndex];
      if (seat) a.folded = seat.folded;
      const actor = st?.actionSeat ?? -1;
      if (actor !== a.lastActor) {
        a.lastActor = actor;
        if (actor >= 0 && actor !== seatIndex && Math.random() < 0.45) lookAtSeat(actor, rand(1.2, 2.4));
      }
    }

    // ---- idle glances: neighbours, the pot, the player ----
    if (t > a.nextGlance) {
      a.nextGlance = t + rand(3, 8) * (a.folded ? 0.7 : 1);
      if (t > a.gazeUntil) {
        const r = Math.random();
        const n = game.engine?.state.seats.length ?? 8;
        if (r < 0.3) lookAt(0, 0, 0.32, rand(1, 2.2));
        else if (r < 0.55) lookAtSeat(0, rand(0.8, 1.6));
        else lookAtSeat((seatIndex + (Math.random() < 0.5 ? 1 : n - 1) * (Math.random() < 0.7 ? 1 : 2)) % n, rand(0.8, 1.8));
      }
    }
    const gazing = t < a.gazeUntil;

    // ---- weight shifts every few seconds ----
    if (t > a.shiftAt) {
      a.shiftAt = t + rand(5, 12);
      const side = Math.random() < 0.5 ? -1 : 1;
      const foot = Math.random() < 0.35 ? (Math.random() < 0.5 ? "L" : "R") : null;
      a.shift = {
        roll: side * rand(0.012, 0.035),
        twist: rand(-0.06, 0.06),
        lean: rand(-0.025, 0.03),
        spreadL: rand(-0.03, 0.06),
        spreadR: -rand(-0.03, 0.06),
        legL: foot === "L" ? 0.08 : 0,
        kneeL: foot === "L" ? -0.22 : 0,
        legR: foot === "R" ? 0.08 : 0,
        kneeR: foot === "R" ? -0.22 : 0,
      };
    }
    const sk = 1 - Math.exp(-dt * 0.9);
    for (const k of KEYS) {
      const cur = a.shiftCur[k] ?? 0;
      a.shiftCur[k] = cur + ((a.shift[k] ?? 0) - cur) * sk;
    }

    // ---- target pose: rest + weight shift + micro-sway + gaze ----
    const target = { ...SEATED };
    for (const k of KEYS) target[k] += a.shiftCur[k] ?? 0;
    target.lean += Math.sin(t * 0.33) * 0.01;
    target.roll += Math.sin(t * 0.27) * 0.006;
    target.headPitch += Math.sin(t * 0.47) * 0.025;
    target.headYaw += Math.sin(t * 0.21) * 0.08 + Math.sin(t * 0.53) * 0.03;
    target.shL += Math.sin(t * 0.9) * 0.025;
    target.shR += Math.sin(t * 0.9 + 1) * 0.025;
    if (gazing) {
      target.headYaw = a.gazeYaw;
      target.headPitch = a.gazePitch;
      target.twist += a.gazeYaw * 0.2;
      target.headRoll += -a.gazeYaw * 0.04;
    }

    a.foldW += ((a.folded ? 1 : 0) - a.foldW) * (1 - Math.exp(-dt * 2.5));
    target.lean -= 0.16 * a.foldW;
    for (const k of Object.keys(FOLDED) as (keyof Pose)[]) target[k] += (FOLDED[k]! - target[k]) * a.foldW;

    // ---- gesture layers, blended in order ----
    a.layers = a.layers.filter((l) => t - l.start < GESTURES[l.kind].dur && !(l.release >= 0 && t - l.release > 0.32));
    for (const l of a.layers) {
      const w = layerWeight(l, t);
      if (w <= 0) continue;
      const g = GESTURES[l.kind];
      const phase = (t - l.start) / g.dur;
      const gp = g.pose(target, Math.sin(phase * Math.PI), phase);
      for (const k of Object.keys(gp) as (keyof Pose)[]) target[k] += (gp[k]! - target[k]) * w;
    }

    // ---- springs toward the target ----
    const c = a.cur;
    const vel = a.vel;
    for (const k of KEYS) [c[k], vel[k]] = damp(c[k], vel[k], target[k], OMEGA[k], dt);

    // ---- breathing on top of the sprung pose ----
    a.breathPhase += dt * a.breathRate * (1 + 0.12 * Math.sin(t * 0.07));
    const b = breathCurve(a.breathPhase);

    if (body.current) {
      body.current.position.y = 0.52 + b * 0.003;
      body.current.rotation.z = c.roll;
    }
    if (spine.current) spine.current.rotation.set(c.lean + b * 0.016, c.twist * 0.5, -c.roll * 0.5);
    if (chest.current) {
      chest.current.rotation.set(c.lean * 0.5, c.twist * 0.5, -c.roll * 0.4);
      chest.current.scale.set(1 + b * 0.014, 1 + b * 0.006, 1 + b * 0.024);
    }
    // the head holds its gaze while the torso twists beneath it
    const look = c.headYaw - c.twist;
    if (neck.current) neck.current.rotation.set(c.lean * 0.4, look * 0.3, 0);
    if (head.current) head.current.rotation.set(c.headPitch - c.lean * 0.4 - b * 0.012, look * 0.7, c.headRoll - c.roll * 0.1);
    setJoint(shL, [c.shL, c.outL, 0]);
    setJoint(shR, [c.shR, c.outR, 0]);
    if (shL.current) shL.current.position.y = SHOULDER_Y + b * 0.005;
    if (shR.current) shR.current.position.y = SHOULDER_Y + b * 0.005;
    setJoint(elL, [c.elL, 0, 0]);
    setJoint(elR, [c.elR, 0, 0]);
    setJoint(thL, [c.legL, c.spreadL, 0]);
    setJoint(thR, [c.legR, c.spreadR, 0]);
    setJoint(knL, [c.kneeL, 0, 0]);
    setJoint(knR, [c.kneeR, 0, 0]);

    // ---- blinks ----
    if (t > a.blinkAt + 0.16) a.blinkAt = t + rand(2, 6) * (Math.random() < 0.15 ? 0.15 : 1);
    const bt = (t - a.blinkAt) / 0.16;
    const lid = bt >= 0 && bt <= 1 ? 1 - Math.sin(bt * Math.PI) * 0.88 : 1;
    if (eyeL.current) eyeL.current.scale.y = lid;
    if (eyeR.current) eyeR.current.scale.y = lid;
  });

  const female = cast.gender === "f";
  const beardLen = female ? 0 : cast.beard;

  return (
    <group ref={root} position={[p.x, 0, p.z]} rotation={[0, facing, 0]} scale={scale}>
      <group ref={body} position={[0, 0.52, 0.03]}>
        {/* hips */}
        <mesh geometry={G.waist} material={M.tunic} position={[0, -0.02, 0]} castShadow />
        <mesh geometry={G.skirt} material={M.tunic} position={[0, -0.14, 0]} castShadow />
        {/* thighs */}
        <group ref={thL} position={[0.1, -0.02, 0]}>
          <mesh geometry={G.thigh} material={M.tunic} position={[0, -0.22, 0]} castShadow />
          <group ref={knL} position={[0, -0.44, 0]}>
            <mesh geometry={G.shin} material={M.leather} position={[0, -0.21, 0]} castShadow />
            <mesh geometry={G.foot} material={M.leather} position={[0, -0.43, 0.07]} castShadow />
          </group>
        </group>
        <group ref={thR} position={[-0.1, -0.02, 0]}>
          <mesh geometry={G.thigh} material={M.tunic} position={[0, -0.22, 0]} castShadow />
          <group ref={knR} position={[0, -0.44, 0]}>
            <mesh geometry={G.shin} material={M.leather} position={[0, -0.21, 0]} castShadow />
            <mesh geometry={G.foot} material={M.leather} position={[0, -0.43, 0.07]} castShadow />
          </group>
        </group>

        {/* spine */}
        <group ref={spine} position={[0, 0.06, 0]}>
          <mesh geometry={G.torso} material={M.tunic} position={[0, 0.16, 0]} castShadow />
          <mesh geometry={G.belt} material={M.leather} position={[0, 0.02, 0]} rotation={[Math.PI / 2, 0, 0]} />
          <mesh position={[0, 0.02, 0.17]} material={M.brass}>
            <boxGeometry args={[0.05, 0.05, 0.012]} />
          </mesh>
          {/* cloak */}
          {cast.cloak > 0 && (
            <group position={[0, 0.34, -0.05]} rotation={[0.1, Math.PI, 0]}>
              <mesh geometry={G.cloak} material={M.cloak} castShadow />
            </group>
          )}
          <group ref={chest} position={[0, 0.44, 0]}>
            <mesh geometry={G.torso} material={M.tunic} position={[0, 0.02, 0]} scale={[0.95, 0.62, 0.9]} castShadow />
            {/* shoulders */}
            <mesh geometry={G.shoulder} material={M.tunic} position={[0.19, 0.08, 0]} scale={[1.12, 0.8, 1.05]} castShadow />
            <mesh geometry={G.shoulder} material={M.tunic} position={[-0.19, 0.08, 0]} scale={[1.12, 0.8, 1.05]} castShadow />
            {/* neck + head */}
            <group ref={neck} position={[0, 0.1, 0]}>
              <mesh geometry={G.neck} material={M.skin} position={[0, 0.03, 0]} />
              <group ref={head} position={[0, 0.11, 0]}>
                <mesh geometry={G.head} material={M.skin} castShadow />
                <mesh geometry={G.jaw} material={M.skin} position={[0, -0.055, 0.022]} scale={[0.92, 0.8, 0.95]} />
                <mesh geometry={G.nose} material={M.skin} position={[0, -0.005, 0.1]} rotation={[Math.PI / 2, 0, 0]} />
                <mesh geometry={G.ear} material={M.skin} position={[0.098, 0, 0]} scale={[0.6, 1, 0.8]} />
                <mesh geometry={G.ear} material={M.skin} position={[-0.098, 0, 0]} scale={[0.6, 1, 0.8]} />
                {/* eyes + brows */}
                <mesh ref={eyeL} geometry={G.eye} material={M.eye} position={[0.038, 0.016, 0.089]} />
                <mesh ref={eyeR} geometry={G.eye} material={M.eye} position={[-0.038, 0.016, 0.089]} />
                <mesh geometry={G.brow} material={M.hair} position={[0.038, 0.043, 0.09]} rotation={[0, 0, 0.12]} />
                <mesh geometry={G.brow} material={M.hair} position={[-0.038, 0.043, 0.09]} rotation={[0, 0, -0.12]} />
                {/* hair */}
                <mesh geometry={G.hairCap} material={M.hair} position={[0, 0.008, -0.008]} scale={[1.02, 1.06, 1.04]} castShadow />
                {(cast.hairStyle === "braids" || cast.hairStyle === "long") && (
                  <>
                    <mesh geometry={G.braid} material={M.hair} position={[0.085, -0.06, -0.03]} rotation={[0.1, 0, 0.08]} />
                    <mesh geometry={G.braid} material={M.hair} position={[-0.085, -0.06, -0.03]} rotation={[0.1, 0, -0.08]} />
                  </>
                )}
                {cast.hairStyle === "long" && (
                  <mesh geometry={G.braid} material={M.hair} position={[0, -0.09, -0.06]} scale={[3.2, 1.5, 1]} />
                )}
                {cast.hairStyle === "topknot" && (
                  <mesh geometry={G.braid} material={M.hair} position={[0, 0.12, -0.01]} rotation={[0, 0, 0]} scale={[0.8, 0.7, 0.8]} />
                )}
                {cast.hairStyle === "shaved" && (
                  <mesh geometry={G.braid} material={M.hair} position={[0, 0.055, 0.055]} scale={[2.6, 0.25, 1.4]} />
                )}
                {cast.hairStyle === "short" && (
                  <mesh geometry={G.braid} material={M.hair} position={[0, -0.01, -0.075]} scale={[3.4, 0.5, 1.2]} />
                )}
                {/* beard */}
                {beardLen > 0.05 && (
                  <mesh
                    geometry={G.beard}
                    material={M.hair}
                    position={[0, -0.05 - beardLen * 0.05, 0.028]}
                    scale={[0.95, 0.55 + beardLen * 0.9, 0.85 + beardLen * 0.2]}
                    castShadow
                  />
                )}
                {cast.accessory === "eyepatch" && (
                  <>
                    <mesh position={[0.038, 0.016, 0.086]} material={M.leather}>
                      <sphereGeometry args={[0.022, 8, 6]} />
                    </mesh>
                    <mesh position={[0, 0.016, 0.086]} rotation={[Math.PI / 2, 0, 0]} material={M.leather}>
                      <torusGeometry args={[0.1, 0.004, 4, 12]} />
                    </mesh>
                  </>
                )}
              </group>
              {/* neck ornament */}
              {cast.accessory === "torc" && (
                <mesh geometry={G.torc} material={M.brass} position={[0, -0.015, 0.01]} rotation={[Math.PI / 2 - 0.2, 0, 0]} />
              )}
              {cast.accessory === "scarf" && (
                <mesh geometry={G.torc} material={M.cloak} position={[0, -0.01, 0.01]} rotation={[Math.PI / 2 - 0.2, 0, 0]} scale={[1.15, 1.15, 1.6]} />
              )}
              {cast.accessory === "pendant" && (
                <mesh position={[0, -0.05, 0.075]} material={M.brass}>
                  <boxGeometry args={[0.028, 0.036, 0.008]} />
                </mesh>
              )}
            </group>

            {/* arms */}
            <group ref={shL} position={[0.195, SHOULDER_Y, 0]}>
              <mesh geometry={G.upperArm} material={M.tunic} position={[0, -0.15, 0]} castShadow />
              <group ref={elL} position={[0, -0.3, 0]}>
                <mesh geometry={G.forearm} material={M.skin} position={[0, -0.15, 0]} castShadow />
                {cast.accessory === "armring" && (
                  <mesh geometry={G.armring} material={M.brass} position={[0, -0.1, 0]} rotation={[Math.PI / 2, 0, 0]} />
                )}
                <mesh geometry={G.handL} material={M.skin} position={[0, -0.29, 0]} castShadow />
              </group>
            </group>
            <group ref={shR} position={[-0.195, SHOULDER_Y, 0]}>
              <mesh geometry={G.upperArm} material={M.tunic} position={[0, -0.15, 0]} castShadow />
              <group ref={elR} position={[0, -0.3, 0]}>
                <mesh geometry={G.forearm} material={M.skin} position={[0, -0.15, 0]} castShadow />
                {cast.accessory === "armring" && (
                  <mesh geometry={G.armring} material={M.brass} position={[0, -0.1, 0]} rotation={[Math.PI / 2, 0, 0]} />
                )}
                <mesh geometry={G.handR} material={M.skin} position={[0, -0.29, 0]} castShadow />
              </group>
            </group>
          </group>
        </group>
      </group>
    </group>
  );
}

function setJoint(ref: Joint, rot: [number, number, number]) {
  if (!ref.current) return;
  ref.current.rotation.set(rot[0], rot[1], rot[2]);
}
