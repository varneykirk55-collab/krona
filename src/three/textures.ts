/**
 * KRONA — procedural texture library.
 * Everything is painted at runtime onto canvases so the game ships without
 * heavy image downloads while still showing grain, wear and fabric detail.
 */
import * as THREE from "three";
import { Card, RANK_LABEL, SUIT_SYMBOL } from "../poker/types";

const cache = new Map<string, THREE.Texture>();

function canvas(w: number, h: number) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return { c, ctx: c.getContext("2d")! };
}

function finish(c: HTMLCanvasElement, key: string, repeat: [number, number] = [1, 1]) {
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeat[0], repeat[1]);
  tex.anisotropy = 4;
  tex.colorSpace = THREE.SRGBColorSpace;
  cache.set(key, tex);
  return tex;
}

/* ------------------------------------------------------------------ */
/* wood                                                                */
/* ------------------------------------------------------------------ */

export function woodTexture(
  key: string,
  base: string,
  dark: string,
  light: string,
  repeat: [number, number] = [1, 1],
  grainScale = 1
) {
  const k = `wood:${key}`;
  if (cache.has(k)) return cache.get(k)!;
  const S = 512;
  const { c, ctx } = canvas(S, S);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  // broad tonal variation
  for (let i = 0; i < 26; i++) {
    const y = Math.random() * S;
    const h = 8 + Math.random() * 46;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, `rgba(0,0,0,0)`);
    g.addColorStop(0.5, Math.random() > 0.5 ? "rgba(255,220,170,0.10)" : "rgba(0,0,0,0.14)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, y, S, h);
  }
  // grain lines
  ctx.lineWidth = 1;
  for (let i = 0; i < 260; i++) {
    const y = Math.random() * S;
    ctx.strokeStyle = Math.random() > 0.45 ? dark : light;
    ctx.globalAlpha = 0.05 + Math.random() * 0.16;
    ctx.beginPath();
    ctx.moveTo(0, y);
    const steps = 14;
    for (let s = 1; s <= steps; s++) {
      const x = (s / steps) * S;
      const yy = y + Math.sin((s / steps) * Math.PI * (1 + Math.random())) * 5 * grainScale + (Math.random() - 0.5) * 3;
      ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }
  // knots
  for (let i = 0; i < 3; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const r = 8 + Math.random() * 20;
    const g = ctx.createRadialGradient(x, y, 1, x, y, r);
    g.addColorStop(0, "rgba(40,22,10,0.55)");
    g.addColorStop(0.6, "rgba(70,42,20,0.22)");
    g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.globalAlpha = 1;
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(30,16,8,0.3)";
    for (let j = 1; j < 5; j++) {
      ctx.beginPath();
      ctx.ellipse(x, y, r * (0.3 + j * 0.22), r * (0.2 + j * 0.16), 0, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  // scratches / wear
  ctx.globalAlpha = 0.1;
  for (let i = 0; i < 60; i++) {
    ctx.strokeStyle = Math.random() > 0.5 ? "#000" : "#fff";
    ctx.beginPath();
    const x = Math.random() * S;
    const y = Math.random() * S;
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 60, y + (Math.random() - 0.5) * 12);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return finish(c, k, repeat);
}

/** greyscale bump companion for carved detail */
export function patternBump(key: string, draw: (ctx: CanvasRenderingContext2D, S: number) => void, size = 512) {
  const k = `bump:${key}`;
  if (cache.has(k)) return cache.get(k)!;
  const { c, ctx } = canvas(size, size);
  ctx.fillStyle = "#808080";
  ctx.fillRect(0, 0, size, size);
  draw(ctx, size);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  cache.set(k, tex);
  return tex;
}

/** Norse knotwork / Urnes-style interlace used for carvings. */
export function knotPattern(repeat: [number, number] = [6, 1]) {
  const k = `knot:${repeat[0]}:${repeat[1]}`;
  if (cache.has(k)) return cache.get(k)!;
  const S = 256;
  const { c, ctx } = canvas(S, S);
  ctx.strokeStyle = "#e9e2cf";
  ctx.lineWidth = 9;
  ctx.lineCap = "round";
  // interlaced circles grid
  for (let gx = 0; gx < 2; gx++) {
    for (let gy = 0; gy < 2; gy++) {
      const cx = 64 + gx * 128;
      const cy = 64 + gy * 128;
      ctx.beginPath();
      ctx.arc(cx, cy, 42, 0, Math.PI * 2);
      ctx.stroke();
    }
  }
  ctx.lineWidth = 7;
  for (let i = 0; i < 4; i++) {
    const x = (i % 2) * 128;
    const y = Math.floor(i / 2) * 128;
    ctx.beginPath();
    ctx.moveTo(x + 8, y + 8);
    ctx.lineTo(x + 120, y + 120);
    ctx.moveTo(x + 120, y + 8);
    ctx.lineTo(x + 8, y + 120);
    ctx.stroke();
  }
  return finish(c, k, repeat);
}

/* ------------------------------------------------------------------ */
/* felt                                                                */
/* ------------------------------------------------------------------ */

/** Deep blue felt with the Swedish flag cross woven into the cloth. */
export function feltTexture() {
  const k = "felt";
  if (cache.has(k)) return cache.get(k)!;
  const W = 1024;
  const H = 640;
  const { c, ctx } = canvas(W, H);
  ctx.fillStyle = "#14315e";
  ctx.fillRect(0, 0, W, H);
  // Swedish cross: vertical at 3/8 width, horizontal at 5/11 height
  const cx = W * 0.375;
  const cy = H * 0.455;
  const band = H * 0.2;
  ctx.fillStyle = "#f2c53d";
  ctx.fillRect(cx - band / 2, 0, band, H);
  ctx.fillRect(0, cy - band * 0.42, W, band * 0.84);
  // subtle inner shading on the cross so it reads as woven, not printed
  const g1 = ctx.createLinearGradient(cx - band / 2, 0, cx + band / 2, 0);
  g1.addColorStop(0, "rgba(0,0,0,0.22)");
  g1.addColorStop(0.35, "rgba(255,255,255,0.10)");
  g1.addColorStop(1, "rgba(0,0,0,0.26)");
  ctx.fillStyle = g1;
  ctx.fillRect(cx - band / 2, 0, band, H);
  const g2 = ctx.createLinearGradient(0, cy - band * 0.42, 0, cy + band * 0.42);
  g2.addColorStop(0, "rgba(0,0,0,0.22)");
  g2.addColorStop(0.35, "rgba(255,255,255,0.10)");
  g2.addColorStop(1, "rgba(0,0,0,0.26)");
  ctx.fillStyle = g2;
  ctx.fillRect(0, cy - band * 0.42, W, band * 0.84);
  // fabric noise
  const img = ctx.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const n = (Math.random() - 0.5) * 26;
    d[i] = Math.max(0, Math.min(255, d[i] + n));
    d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n));
    d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n * 0.9));
  }
  ctx.putImageData(img, 0, 0);
  // fibrous brush strokes
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 2200; i++) {
    ctx.strokeStyle = Math.random() > 0.5 ? "#ffffff" : "#000000";
    const x = Math.random() * W;
    const y = Math.random() * H;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + (Math.random() - 0.5) * 16, y + (Math.random() - 0.5) * 6);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return finish(c, k, [1, 1]);
}

/* ------------------------------------------------------------------ */
/* cards                                                               */
/* ------------------------------------------------------------------ */

const SUIT_PATH: Record<string, string> = {
  s: "M50 8 C50 8 12 46 12 66 C12 80 24 90 36 90 C42 90 47 87 50 83 C50 92 44 98 36 103 L64 103 C56 98 50 92 50 83 C53 87 58 90 64 90 C76 90 88 80 88 66 C88 46 50 8 50 8 Z",
  h: "M50 100 C50 100 8 62 8 38 C8 20 22 10 34 10 C42 10 47 14 50 20 C53 14 58 10 66 10 C78 10 92 20 92 38 C92 62 50 100 50 100 Z",
  d: "M50 6 L88 54 L50 102 L12 54 Z",
  c: "M28 26 C13 26 6 38 6 48 C6 62 17 70 27 70 C34 70 40 66 44 60 C44 70 40 78 30 86 L70 86 C60 78 56 70 56 60 C60 66 66 70 73 70 C83 70 94 62 94 48 C94 38 87 26 72 26 C62 26 55 32 52 38 C49 30 42 26 28 26 Z",
};

export function cardFaceTexture(card: Card) {
  const k = `card:${card.id}`;
  if (cache.has(k)) return cache.get(k)!;
  const W = 256;
  const H = 358;
  const { c, ctx } = canvas(W, H);
  // paper
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, "#fdfaf1");
  bg.addColorStop(0.5, "#f6f1e4");
  bg.addColorStop(1, "#eee8d8");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);
  const red = card.s === "h" || card.s === "d";
  const ink = red ? "#9d1b1b" : "#20242c";
  // border
  ctx.strokeStyle = "rgba(150,140,120,0.55)";
  ctx.lineWidth = 5;
  ctx.strokeRect(9, 9, W - 18, H - 18);
  ctx.strokeStyle = "rgba(190,170,120,0.6)";
  ctx.lineWidth = 2;
  ctx.strokeRect(15, 15, W - 30, H - 30);
  // corner indices
  const label = RANK_LABEL[card.r];
  ctx.fillStyle = ink;
  ctx.font = "700 62px Georgia, 'Times New Roman', serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 42, 62);
  ctx.save();
  ctx.translate(42, 118);
  ctx.scale(0.3, 0.3);
  ctx.translate(-50, -54);
  ctx.fillStyle = ink;
  const p = new Path2D(SUIT_PATH[card.s]);
  ctx.fill(p);
  ctx.restore();
  ctx.save();
  ctx.translate(W - 42, H - 118);
  ctx.rotate(Math.PI);
  ctx.scale(0.3, 0.3);
  ctx.translate(-50, -54);
  ctx.fillStyle = ink;
  ctx.fill(new Path2D(SUIT_PATH[card.s]));
  ctx.restore();
  ctx.save();
  ctx.translate(W - 42, H - 62);
  ctx.rotate(Math.PI);
  ctx.fillStyle = ink;
  ctx.font = "700 62px Georgia, 'Times New Roman', serif";
  ctx.textBaseline = "middle";
  ctx.fillText(label, 0, 0);
  ctx.restore();

  // centre pip layout (traditional)
  const layout = pipLayout(card.r);
  ctx.save();
  ctx.translate(W / 2, H / 2);
  for (const pip of layout) {
    ctx.save();
    ctx.translate(pip.x * 0.72, pip.y * 1.02);
    if (pip.flip) ctx.rotate(Math.PI);
    ctx.scale(0.62, 0.62);
    ctx.translate(-50, -54);
    ctx.fillStyle = ink;
    ctx.fill(new Path2D(SUIT_PATH[card.s]));
    ctx.restore();
  }
  ctx.restore();
  // face cards get a Norse-inspired central medallion
  if (card.r >= 11 && card.r <= 13) {
    ctx.save();
    ctx.translate(W / 2, H / 2);
    ctx.strokeStyle = "rgba(160,140,90,0.75)";
    ctx.fillStyle = "rgba(180,150,80,0.10)";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, 62, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(0, 0, 48, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = ink;
    ctx.font = "700 44px Georgia, serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const face = card.r === 11 ? "KNIGHT" : card.r === 12 ? "QUEEN" : "KING";
    ctx.fillText(face, 0, -34);
    ctx.font = "700 54px Georgia, serif";
    ctx.fillText(SUIT_SYMBOL[card.s], 0, 16);
    ctx.restore();
  }
  return finish(c, k);
}

type Pip = { x: number; y: number; flip?: boolean };
function pipLayout(r: number): Pip[] {
  const A = 62;
  const B = 34;
  switch (r) {
    case 2:
      return [{ x: 0, y: -A }, { x: 0, y: A, flip: true }];
    case 3:
      return [{ x: 0, y: -A }, { x: 0, y: 0 }, { x: 0, y: A, flip: true }];
    case 4:
      return [{ x: -B, y: -A }, { x: B, y: -A }, { x: -B, y: A, flip: true }, { x: B, y: A, flip: true }];
    case 5:
      return [{ x: -B, y: -A }, { x: B, y: -A }, { x: 0, y: 0 }, { x: -B, y: A, flip: true }, { x: B, y: A, flip: true }];
    case 6:
      return [
        { x: -B, y: -A }, { x: B, y: -A },
        { x: -B, y: 0 }, { x: B, y: 0 },
        { x: -B, y: A, flip: true }, { x: B, y: A, flip: true },
      ];
    case 7:
      return [
        { x: -B, y: -A }, { x: B, y: -A }, { x: 0, y: -A / 2 },
        { x: -B, y: 0 }, { x: B, y: 0 },
        { x: -B, y: A, flip: true }, { x: B, y: A, flip: true },
      ];
    case 8:
      return [
        { x: -B, y: -A }, { x: B, y: -A }, { x: 0, y: -A / 2 },
        { x: -B, y: 0 }, { x: B, y: 0 }, { x: 0, y: A / 2, flip: true },
        { x: -B, y: A, flip: true }, { x: B, y: A, flip: true },
      ];
    case 9:
      return [
        { x: -B, y: -A }, { x: B, y: -A }, { x: -B, y: -A / 2.6 }, { x: B, y: -A / 2.6 },
        { x: 0, y: 0 },
        { x: -B, y: A / 2.6, flip: true }, { x: B, y: A / 2.6, flip: true },
        { x: -B, y: A, flip: true }, { x: B, y: A, flip: true },
      ];
    case 10:
      return [
        { x: -B, y: -A }, { x: B, y: -A }, { x: -B, y: -A / 2.6 }, { x: B, y: -A / 2.6 }, { x: 0, y: -A / 2 },
        { x: 0, y: A / 2, flip: true },
        { x: -B, y: A / 2.6, flip: true }, { x: B, y: A / 2.6, flip: true },
        { x: -B, y: A, flip: true }, { x: B, y: A, flip: true },
      ];
    default:
      return [];
  }
}

export function cardBackTexture() {
  const k = "cardback";
  if (cache.has(k)) return cache.get(k)!;
  const W = 256;
  const H = 358;
  const { c, ctx } = canvas(W, H);
  const g = ctx.createLinearGradient(0, 0, W, H);
  g.addColorStop(0, "#1d2a4d");
  g.addColorStop(0.5, "#22335f");
  g.addColorStop(1, "#161f3b");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "#c9a341";
  ctx.lineWidth = 6;
  ctx.strokeRect(10, 10, W - 20, H - 20);
  ctx.lineWidth = 1.5;
  ctx.strokeRect(19, 19, W - 38, H - 38);
  // knotwork medallion
  ctx.save();
  ctx.translate(W / 2, H / 2);
  ctx.strokeStyle = "#d8b45c";
  ctx.lineWidth = 2.4;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(0, 0, 26 + i * 16, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 30, Math.sin(a) * 30);
    ctx.lineTo(Math.cos(a + 0.4) * 68, Math.sin(a + 0.4) * 68);
    ctx.stroke();
  }
  // ravens / crowns corner marks
  ctx.fillStyle = "#e6cd8b";
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      ctx.save();
      ctx.translate(sx * 92, sy * 140);
      ctx.beginPath();
      ctx.arc(0, 0, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }
  ctx.restore();
  // woven texture
  ctx.globalAlpha = 0.06;
  for (let i = 0; i < 900; i++) {
    ctx.strokeStyle = Math.random() > 0.5 ? "#fff" : "#000";
    const x = Math.random() * W;
    const y = Math.random() * H;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + 10, y + 3);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  return finish(c, k);
}

/* ------------------------------------------------------------------ */
/* chips                                                               */
/* ------------------------------------------------------------------ */

export function chipFaceTexture(color: string, edge: string, label: string) {
  const k = `chip:${color}:${label}`;
  if (cache.has(k)) return cache.get(k)!;
  const S = 256;
  const { c, ctx } = canvas(S, S);
  ctx.clearRect(0, 0, S, S);
  const cx = S / 2;
  // body
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(cx, cx, S / 2 - 2, 0, Math.PI * 2);
  ctx.fill();
  // gold edge spots (traditional 6-spot chip)
  ctx.fillStyle = edge;
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.save();
    ctx.translate(cx + Math.cos(a) * (S / 2 - 26), cx + Math.sin(a) * (S / 2 - 26));
    ctx.beginPath();
    ctx.ellipse(0, 0, 17, 22, a, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
  // inner ring
  ctx.strokeStyle = edge;
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(cx, cx, S / 2 - 52, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = "rgba(0,0,0,0.35)";
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cx, S / 2 - 62, 0, Math.PI * 2);
  ctx.stroke();
  // denomination
  ctx.fillStyle = "#fdf6e3";
  ctx.font = "700 74px Georgia, serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.save();
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 6;
  ctx.fillText(label, cx, cx + 4);
  ctx.restore();
  // subtle top-down wear
  ctx.globalAlpha = 0.12;
  for (let i = 0; i < 300; i++) {
    ctx.fillStyle = Math.random() > 0.5 ? "#fff" : "#000";
    ctx.fillRect(Math.random() * S, Math.random() * S, 2, 2);
  }
  ctx.globalAlpha = 1;
  return finish(c, k);
}

/* ------------------------------------------------------------------ */
/* misc                                                               */
/* ------------------------------------------------------------------ */

export function snowflakeTexture() {
  const k = "snow";
  if (cache.has(k)) return cache.get(k)!;
  const S = 64;
  const { c, ctx } = canvas(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.35, "rgba(240,248,255,0.75)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return finish(c, k);
}

export function furTexture(base: string) {
  const k = `fur:${base}`;
  if (cache.has(k)) return cache.get(k)!;
  const S = 256;
  const { c, ctx } = canvas(S, S);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 2600; i++) {
    const x = Math.random() * S;
    const y = Math.random() * S;
    const len = 6 + Math.random() * 16;
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 1.1;
    ctx.strokeStyle = Math.random() > 0.5 ? "rgba(255,255,255,0.13)" : "rgba(0,0,0,0.16)";
    ctx.lineWidth = 1 + Math.random();
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  return finish(c, k, [2, 2]);
}

export function runeTexture() {
  const k = "rune";
  if (cache.has(k)) return cache.get(k)!;
  const S = 256;
  const { c, ctx } = canvas(S, S);
  ctx.fillStyle = "#20242b";
  ctx.fillRect(0, 0, S, S);
  ctx.strokeStyle = "#c9a341";
  ctx.lineWidth = 3;
  ctx.font = "700 40px Georgia, serif";
  ctx.fillStyle = "#c9a341";
  const runes = ["\u16A0", "\u16A2", "\u16A5", "\u16A7", "\u16AB", "\u16AF", "\u16B1", "\u16B3", "\u16B7"];
  for (let i = 0; i < 16; i++) {
    ctx.fillText(runes[Math.floor(Math.random() * runes.length)], (i % 4) * 64 + 12, Math.floor(i / 4) * 64 + 48);
  }
  return finish(c, k, [1, 1]);
}

/** Simple vertical gradient sky used behind the village windows. */
export function nightSkyTexture() {
  const k = "sky";
  if (cache.has(k)) return cache.get(k)!;
  const W = 256;
  const H = 256;
  const { c, ctx } = canvas(W, H);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, "#0a1424");
  g.addColorStop(0.55, "#1d3348");
  g.addColorStop(1, "#3d5266");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.6})`;
    ctx.fillRect(Math.random() * W, Math.random() * H * 0.7, 1.4, 1.4);
  }
  return finish(c, k);
}
