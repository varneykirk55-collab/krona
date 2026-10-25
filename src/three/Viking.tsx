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

interface Pose {
  lean: number;
  headPitch: number;
  headYaw: number;
  shoulder: [number, number];
  elbow: [number, number];
  armOut: [number, number];
}

const SEATED: Pose = {
  lean: 0.06,
  headPitch: 0.22,
  headYaw: 0,
  shoulder: [-0.95, -0.95],
  elbow: [-0.55, -0.55],
  armOut: [0.22, -0.22],
};

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

  const anim = useRef({
    gesture: "idle" as string,
    gestureT: -1,
    seed: Math.random() * 100,
    dealt: 0,
    checkAt: 0,
    cur: { ...SEATED, shoulder: [...SEATED.shoulder], elbow: [...SEATED.elbow], armOut: [...SEATED.armOut] } as Pose,
    folded: false,
    speaking: 0,
  });

  useFrame((state, dt) => {
    const a = anim.current;
    const t = state.clock.elapsedTime + a.seed;
    const now = performance.now();

    // ---- read public game state (cheap, throttled) ----
    if (now - a.checkAt > 220) {
      a.checkAt = now;
      const v = game.view;
      const mine = v.cards.filter((c) => c.holder === seatIndex).length;
      if (mine > a.dealt) {
        a.dealt = mine;
        a.gesture = "peek";
        a.gestureT = t;
      } else if (mine < a.dealt) a.dealt = mine;
      const ha = v.handAction;
      if (ha && ha.seat === seatIndex && ha.t !== (a as unknown as { lastHa?: number }).lastHa) {
        (a as unknown as { lastHa?: number }).lastHa = ha.t;
        if (ha.kind === "fold") a.folded = true;
        else if (ha.kind === "check") a.gesture = "check";
        else if (ha.kind === "chips") a.gesture = "chips";
        else if (ha.kind === "deal" || ha.kind === "deal-self") a.gesture = "deal";
        else if (ha.kind === "think") a.gesture = "think";
        if (ha.kind !== "fold") a.folded = false;
        a.gestureT = t;
      }
      const seat = game.engine?.state.seats[seatIndex];
      if (seat) a.folded = seat.folded;
    }

    // ---- target pose ----
    const target: Pose = {
      lean: SEATED.lean,
      headPitch: SEATED.headPitch,
      headYaw: Math.sin(t * 0.21) * 0.14,
      shoulder: [...SEATED.shoulder],
      elbow: [...SEATED.elbow],
      armOut: [...SEATED.armOut],
    };

    const breathe = Math.sin(t * 1.15) * 0.5 + 0.5;
    target.lean += breathe * 0.022 + Math.sin(t * 0.33) * 0.012;
    target.headPitch += Math.sin(t * 0.47) * 0.03;
    target.shoulder[0] += Math.sin(t * 0.9) * 0.03;
    target.shoulder[1] += Math.sin(t * 0.9 + 1) * 0.03;

    if (a.folded) {
      target.lean -= 0.16;
      target.headPitch = 0.05;
      target.shoulder = [-0.35, -0.35];
      target.elbow = [-0.2, -0.2];
    }

    const gt = t - a.gestureT;
    const g = a.gesture;
    if (g !== "idle" && gt < 2.4) {
      // bell curve envelope so gestures ease in and out
      const env = Math.sin(Math.min(1, gt / 1.6) * Math.PI);
      if (g === "peek") {
        target.lean += env * 0.2;
        target.headPitch += env * 0.5;
        target.shoulder = [-1.25, -1.3];
        target.elbow = [-1.15, -1.2];
      } else if (g === "deal") {
        target.shoulder[1] = -1.5 + env * 0.2;
        target.elbow[1] = -0.25 - env * 0.1;
        target.armOut[1] = -0.12 - env * 0.06;
        target.lean += env * 0.08;
      } else if (g === "chips") {
        target.shoulder[1] = -1.1 - env * 0.25;
        target.elbow[1] = -0.7 - env * 0.35;
        target.lean += env * 0.06;
      } else if (g === "check") {
        target.shoulder[1] = -1.15;
        target.elbow[1] = -0.9 + env * 0.5;
      } else if (g === "think") {
        target.headYaw += env * 0.32;
        target.headPitch += env * 0.12;
        target.shoulder[0] = -1.2;
        target.elbow[0] = -1.4;
      }
    } else if (g !== "idle") {
      a.gesture = "idle";
    }

    // ---- smooth toward the target ----
    const k = Math.min(1, dt * 6.5);
    const c = a.cur;
    c.lean += (target.lean - c.lean) * k;
    c.headPitch += (target.headPitch - c.headPitch) * k;
    c.headYaw += (target.headYaw - c.headYaw) * k;
    for (let i = 0; i < 2; i++) {
      c.shoulder[i] += (target.shoulder[i] - c.shoulder[i]) * k;
      c.elbow[i] += (target.elbow[i] - c.elbow[i]) * k;
      c.armOut[i] += (target.armOut[i] - c.armOut[i]) * k;
    }

    if (spine.current) spine.current.rotation.x = c.lean;
    if (chest.current) {
      chest.current.rotation.x = c.lean * 0.5;
      chest.current.scale.set(1 + breathe * 0.014, 1, 1 + breathe * 0.022);
    }
    if (neck.current) neck.current.rotation.x = c.lean * 0.4;
    if (head.current) {
      head.current.rotation.x = c.headPitch - c.lean * 0.4;
      head.current.rotation.y = c.headYaw;
    }
    setJoint(shL, [c.shoulder[0], c.armOut[0], 0]);
    setJoint(shR, [c.shoulder[1], c.armOut[1], 0]);
    setJoint(elL, [c.elbow[0], 0, 0]);
    setJoint(elR, [c.elbow[1], 0, 0]);
    setJoint(thL, [-1.5, 0.06 + Math.sin(t * 0.5) * 0.02, 0]);
    setJoint(thR, [-1.5, -0.06, 0]);
    setJoint(knL, [1.45, 0, 0]);
    setJoint(knR, [1.45, 0, 0]);
    if (body.current) body.current.position.y = 0.52 + Math.sin(t * 0.9) * 0.0028;
    if (root.current) root.current.rotation.z = Math.sin(t * 0.27) * 0.008;
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
                <mesh geometry={G.eye} material={M.eye} position={[0.038, 0.016, 0.089]} />
                <mesh geometry={G.eye} material={M.eye} position={[-0.038, 0.016, 0.089]} />
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
            <group ref={shL} position={[0.195, 0.07, 0]}>
              <mesh geometry={G.upperArm} material={M.tunic} position={[0, -0.15, 0]} castShadow />
              <group ref={elL} position={[0, -0.3, 0]}>
                <mesh geometry={G.forearm} material={M.skin} position={[0, -0.15, 0]} castShadow />
                {cast.accessory === "armring" && (
                  <mesh geometry={G.armring} material={M.brass} position={[0, -0.1, 0]} rotation={[Math.PI / 2, 0, 0]} />
                )}
                <mesh geometry={G.handL} material={M.skin} position={[0, -0.29, 0]} castShadow />
              </group>
            </group>
            <group ref={shR} position={[-0.195, 0.07, 0]}>
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
