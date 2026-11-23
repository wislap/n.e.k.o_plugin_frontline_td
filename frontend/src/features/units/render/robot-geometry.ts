// Robot unit silhouette (visual-languages): replaces the primitive
// cylinder/box/cone/sphere bodies in themed modes with a small robot —
// twin treads, chamfered body, head/sensor block, emissive eye slit and a
// faction accent band. Merged into one BufferGeometry with the same
// aSlot convention as structure silhouettes (0 body, 1 trim, 2 faction
// accent, 3 emissive); unit-box space (x,z in [-0.5,0.5], base at y=0).
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

type PartSlot = 0 | 1 | 2 | 3;

function part(
  geo: THREE.BufferGeometry,
  x: number,
  y: number,
  z: number,
  slot: PartSlot,
): THREE.BufferGeometry {
  if (geo.index !== null) {
    const ni = geo.toNonIndexed();
    geo.dispose();
    geo = ni;
  }
  geo.translate(x, y, z);
  const count = geo.getAttribute('position').count;
  const slots = new Float32Array(count);
  slots.fill(slot);
  geo.setAttribute('aSlot', new THREE.BufferAttribute(slots, 1));
  return geo;
}

// Small hard-surface robot ~0.5 tall in unit space (scaled by the layer
// to 2*radius wide × scale tall per unit kind).
export function buildRobotGeometry(bevel: number): THREE.BufferGeometry {
  const r = (a: number, b: number, c: number) => Math.min(bevel, Math.min(a, b, c) * 0.45);
  const parts: THREE.BufferGeometry[] = [
    // Treads: two dark graphite rails.
    part(new RoundedBoxGeometry(0.3, 0.16, 0.5, 2, r(0.3, 0.16, 0.5)), -0.16, 0.08, 0, 1),
    part(new RoundedBoxGeometry(0.3, 0.16, 0.5, 2, r(0.3, 0.16, 0.5)), 0.16, 0.08, 0, 1),
    // Body shell.
    part(new RoundedBoxGeometry(0.44, 0.24, 0.4, 2, r(0.44, 0.24, 0.4)), 0, 0.28, 0, 0),
    // Faction accent band across the body top edge.
    part(new THREE.BoxGeometry(0.46, 0.05, 0.42), 0, 0.4, 0, 2),
    // Head / sensor block, slightly forward.
    part(new RoundedBoxGeometry(0.26, 0.16, 0.26, 2, r(0.26, 0.16, 0.26)), 0, 0.5, 0.04, 0),
    // Emissive eye slit on the head front.
    part(new THREE.BoxGeometry(0.18, 0.04, 0.02), 0, 0.52, 0.18, 3),
  ];
  const merged = mergeGeometries(parts, false);
  for (const p of parts) {
    p.dispose();
  }
  merged.userData['shared'] = true;
  return merged;
}
