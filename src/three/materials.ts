/**
 * KRONA — shared materials & geometries.
 * Sharing these keeps the draw call count low on mobile GPUs.
 */
import * as THREE from "three";
import { woodTexture, feltTexture, cardFaceTexture, cardBackTexture, chipFaceTexture, knotPattern, furTexture } from "./textures";
import { CHIP_DENOMS } from "../game/view";

const c2 = document.createElement("canvas");

function sideTexture(color: string, edge: string) {
  const W = 256;
  const H = 32;
  const c = c2.cloneNode() as HTMLCanvasElement;
  c.width = W;
  c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, W, H);
  // gold edge spots wrapping the rim
  const seg = W / 8;
  for (let i = 0; i < 8; i++) {
    ctx.fillStyle = i % 2 === 0 ? edge : color;
    ctx.fillRect(i * seg, 0, seg * 0.55, H);
    ctx.fillStyle = "rgba(0,0,0,0.25)";
    ctx.fillRect(i * seg + seg * 0.55, H * 0.42, seg * 0.45, H * 0.16);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/* ---------------- wood / environment ---------------- */

export const MATS = {
  oak: new THREE.MeshStandardMaterial({
    map: woodTexture("oak", "#6b4a2a", "#2f1d0f", "#a87c48", [2, 2], 1.1),
    bumpMap: knotPattern([4, 1]),
    bumpScale: 0.012,
    color: "#c9a678",
    roughness: 0.72,
    metalness: 0.02,
  }),
  darkOak: new THREE.MeshStandardMaterial({
    map: woodTexture("darkoak", "#3d2716", "#180d06", "#6b4a2a", [2, 2], 1),
    color: "#8d7355",
    roughness: 0.66,
    metalness: 0.03,
  }),
  floor: new THREE.MeshStandardMaterial({
    map: woodTexture("floor", "#4e3620", "#1d1208", "#8a6634", [8, 8], 0.7),
    color: "#9b7c56",
    roughness: 0.8,
    metalness: 0.02,
  }),
  ceiling: new THREE.MeshStandardMaterial({
    map: woodTexture("ceiling", "#2e1f13", "#120a05", "#4f3a22", [6, 6], 0.9),
    color: "#6d5738",
    roughness: 0.85,
  }),
  felt: new THREE.MeshStandardMaterial({
    map: feltTexture(),
    color: "#ffffff",
    roughness: 0.98,
    metalness: 0,
  }),
  leather: new THREE.MeshStandardMaterial({ color: "#3a2418", roughness: 0.55, metalness: 0.05 }),
  brass: new THREE.MeshStandardMaterial({ color: "#c9a341", roughness: 0.3, metalness: 0.92 }),
  iron: new THREE.MeshStandardMaterial({ color: "#3b3d40", roughness: 0.42, metalness: 0.86 }),
  stone: new THREE.MeshStandardMaterial({ color: "#6a6459", roughness: 0.92, metalness: 0.02 }),
  snow: new THREE.MeshStandardMaterial({ color: "#e8eef7", roughness: 0.78, metalness: 0 }),
  furWhite: new THREE.MeshStandardMaterial({ map: furTexture("#b9ab98"), color: "#d8cec0", roughness: 0.95 }),
  furDark: new THREE.MeshStandardMaterial({ map: furTexture("#4a3a2c"), color: "#8a7561", roughness: 0.95 }),
  glass: new THREE.MeshStandardMaterial({
    color: "#9fc4d8",
    roughness: 0.15,
    metalness: 0.1,
    transparent: true,
    opacity: 0.18,
  }),
  flame: new THREE.MeshBasicMaterial({ color: "#ffb347", transparent: true, opacity: 0.9 }),
  candle: new THREE.MeshStandardMaterial({ color: "#e9dfc8", roughness: 0.6 }),
  cardEdge: new THREE.MeshStandardMaterial({ color: "#efe6d2", roughness: 0.7 }),
  cardBack: new THREE.MeshStandardMaterial({ map: cardBackTexture(), roughness: 0.62 }),
  skin: (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.68, metalness: 0 }),
};

/* ---------------- cards ---------------- */

export const CARD_W = 0.0635;
export const CARD_L = 0.0889;
export const CARD_T = 0.0006;

export const cardBodyGeo = new THREE.BoxGeometry(CARD_W, CARD_T, CARD_L);
export const cardFaceGeo = new THREE.PlaneGeometry(CARD_W * 0.998, CARD_L * 0.998);

const faceMats = new Map<string, THREE.MeshStandardMaterial>();
export function cardFaceMat(id: string) {
  let m = faceMats.get(id);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      map: cardFaceTexture({ r: parseInt(id.slice(0, -1), 10), s: id.slice(-1) as "s", id }),
      roughness: 0.42,
      metalness: 0.02,
    });
    faceMats.set(id, m);
  }
  return m;
}

/* ---------------- chips ---------------- */

export const CHIP_R = 0.0215;
export const CHIP_H = 0.0036;

export const chipGeo = new THREE.CylinderGeometry(CHIP_R, CHIP_R, CHIP_H, 22, 1);

export const CHIP_MATS = CHIP_DENOMS.map((d) => {
  const face = new THREE.MeshStandardMaterial({
    map: chipFaceTexture(d.color, d.edge, d.label),
    roughness: 0.42,
    metalness: 0.18,
  });
  const side = new THREE.MeshStandardMaterial({
    map: sideTexture(d.color, d.edge),
    roughness: 0.5,
    metalness: 0.22,
  });
  return [side, face, face] as THREE.Material[];
});

/* ---------------- dealer button ---------------- */

export const buttonGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.006, 20);

function buttonTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#f2ead5";
  ctx.fillRect(0, 0, 128, 128);
  ctx.strokeStyle = "#1b2440";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(64, 64, 48, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#1b2440";
  ctx.font = "700 62px Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("D", 64, 68);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
export const buttonMats = [
  new THREE.MeshStandardMaterial({ color: "#b98f3c", roughness: 0.35, metalness: 0.8 }),
  new THREE.MeshStandardMaterial({ map: buttonTexture(), roughness: 0.5 }),
  new THREE.MeshStandardMaterial({ map: buttonTexture(), roughness: 0.5 }),
] as THREE.Material[];

/* ---------------- misc geometry ---------------- */

export function stadiumShape(rx: number, rz: number) {
  const s = new THREE.Mesh;
  void s;
  const shape = new THREE.Shape();
  const straight = Math.max(0.001, rx - rz);
  shape.moveTo(straight, rz);
  shape.lineTo(-straight, rz);
  shape.absarc(-straight, 0, rz, Math.PI / 2, Math.PI * 1.5, false);
  shape.lineTo(straight, -rz);
  shape.absarc(straight, 0, rz, Math.PI * 1.5, Math.PI * 2.5, false);
  return shape;
}

export function stadiumGeometry(rx: number, rz: number, depth: number, bevel = 0, curve = 26) {
  const shape = stadiumShape(rx, rz);
  const g = new THREE.ExtrudeGeometry(shape, {
    depth,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 2,
    curveSegments: curve,
  });
  g.rotateX(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}

/** ring (outer stadium with an inner stadium hole) */
export function stadiumRingGeometry(
  orx: number,
  orz: number,
  irx: number,
  irz: number,
  depth: number,
  bevel = 0,
  curve = 26
) {
  const outer = stadiumShape(orx, orz);
  const hole = new THREE.Path(stadiumShape(irx, irz).getPoints(24).reverse().map((p) => new THREE.Vector2(p.x, p.y)));
  outer.holes.push(hole);
  const g = new THREE.ExtrudeGeometry(outer, {
    depth,
    bevelEnabled: bevel > 0,
    bevelSize: bevel,
    bevelThickness: bevel,
    bevelSegments: 2,
    curveSegments: curve,
  });
  g.rotateX(-Math.PI / 2);
  g.computeVertexNormals();
  return g;
}
