/** Hands combine a bevelled palm and wrist with four tapered, curled capsule
 * fingers and an opposed thumb, merged into one shared geometry per side. */
import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

/** Preserve capsule length while narrowing its distal end (local -Y). */
export function taperedCapsule(radius: number, length: number, taper: number) {
  const geometry = new THREE.CapsuleGeometry(radius, length, 6, 12);
  const positions = geometry.getAttribute("position");
  const half = length / 2 + radius;
  for (let i = 0; i < positions.count; i++) {
    const y = positions.getY(i);
    const width = THREE.MathUtils.lerp(taper, 1, (y + half) / (2 * half));
    positions.setXYZ(i, positions.getX(i) * width, y, positions.getZ(i) * width);
  }
  geometry.computeVertexNormals();
  return geometry;
}

export function handGeometry(side: 1 | -1) {
  const parts: THREE.BufferGeometry[] = [];
  const palm = new RoundedBoxGeometry(0.071, 0.061, 0.029, 3, 0.011);
  parts.push(palm);
  const wrist = taperedCapsule(0.022, 0.026, 0.9);
  wrist.scale(1, 1, 0.72);
  wrist.translate(0, 0.03, 0);
  parts.push(wrist);

  // Local -Y follows the forearm; +Z is the palm side. Curl grows at
  // both knuckles, with a rounded capsule tip and no extra rig joints.
  const lengths = [0.052, 0.059, 0.055, 0.043];
  for (let finger = 0; finger < 4; finger++) {
    const radius = finger === 3 ? 0.007 : 0.008;
    const length = lengths[finger];
    const geometry = taperedCapsule(radius, length - radius * 2, 0.76);
    const positions = geometry.getAttribute("position");
    for (let i = 0; i < positions.count; i++) {
      const y = positions.getY(i);
      const t = THREE.MathUtils.clamp((length / 2 - y) / length, 0, 1);
      const curl = Math.max(0, t - 0.35) * 0.3 + Math.max(0, t - 0.7) * 0.35;
      positions.setXYZ(i,
        positions.getX(i) + (finger - 1.5) * 0.002 * t,
        y + 0.006 * t * t,
        positions.getZ(i) + length * curl);
    }
    geometry.translate((finger - 1.5) * 0.017, -0.024 - length / 2, 0);
    parts.push(geometry);
  }

  const thumb = taperedCapsule(0.01, 0.027, 0.76);
  thumb.rotateZ(-0.65);
  thumb.rotateY(-0.35);
  thumb.translate(-0.038, -0.015, 0.012);
  parts.push(thumb);

  // RoundedBoxGeometry is non-indexed; normalize before merging.
  const triangles = parts.map((part) => part.index ? part.toNonIndexed() : part);
  const geometry = mergeGeometries(triangles)!;
  for (const part of new Set([...parts, ...triangles])) part.dispose();
  if (side === -1) {
    // Mirror the thumb while keeping both palms and finger curls facing +Z.
    geometry.scale(-1, 1, 1);
    const count = geometry.getAttribute("position").count;
    const indices: number[] = [];
    for (let i = 0; i < count; i += 3) indices.push(i, i + 2, i + 1);
    geometry.setIndex(indices);
  }
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}
