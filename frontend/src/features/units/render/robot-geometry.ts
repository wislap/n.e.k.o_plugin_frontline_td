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

// Small hard-surface robot ~0.65 tall in unit space (scaled by the layer
// to 2*radius wide × scale tall per unit kind). The silhouette reads as
// a robot: wide graphite treads, a narrower white torso, shoulder pods
// and a weapon barrel, plus a separate sensor head with visor + antenna.
export function buildRobotGeometry(bevel: number): THREE.BufferGeometry {
  const r = (a: number, b: number, c: number) => Math.min(bevel, Math.min(a, b, c) * 0.1);
  const parts: THREE.BufferGeometry[] = [
    // Treads: two slim graphite rails set wide, taller than the torso is
    // wide so the running gear reads under the shell.
    part(new RoundedBoxGeometry(0.15, 0.22, 0.5, 2, r(0.15, 0.22, 0.5)), -0.2, 0.11, 0, 1),
    part(new RoundedBoxGeometry(0.15, 0.22, 0.5, 2, r(0.15, 0.22, 0.5)), 0.2, 0.11, 0, 1),
    // Dark chassis plate bridging the treads.
    part(new THREE.BoxGeometry(0.3, 0.06, 0.38), 0, 0.25, 0, 1),
    // Torso — noticeably narrower than the tread span.
    part(new RoundedBoxGeometry(0.3, 0.24, 0.3, 2, r(0.3, 0.24, 0.3)), 0, 0.4, 0, 0),
    // Faction accent stripe around the torso top edge.
    part(new THREE.BoxGeometry(0.31, 0.045, 0.31), 0, 0.47, 0, 2),
    // Shoulder pods — visible arms at torso height.
    part(new RoundedBoxGeometry(0.1, 0.13, 0.16, 2, r(0.1, 0.13, 0.16)), -0.21, 0.45, 0.02, 0),
    part(new RoundedBoxGeometry(0.1, 0.13, 0.16, 2, r(0.1, 0.13, 0.16)), 0.21, 0.45, 0.02, 0),
    // Weapon barrel on the right shoulder, pointing forward.
    part(new THREE.BoxGeometry(0.055, 0.055, 0.26), 0.21, 0.45, 0.2, 1),
    // Graphite neck joint so the head reads as a separate part.
    part(new THREE.BoxGeometry(0.14, 0.06, 0.14), 0, 0.55, 0.02, 1),
    // Sensor head, pushed forward — white shell over graphite.
    part(new RoundedBoxGeometry(0.2, 0.12, 0.2, 2, r(0.2, 0.12, 0.2)), 0, 0.63, 0.05, 0),
    // Emissive visor slit on the head front.
    part(new THREE.BoxGeometry(0.14, 0.04, 0.03), 0, 0.63, 0.16, 3),
    // Antenna nub on the head rear-left — breaks the box silhouette.
    part(new THREE.BoxGeometry(0.025, 0.12, 0.025), -0.07, 0.73, -0.02, 1),
  ];
  const merged = mergeGeometries(parts, false);
  for (const p of parts) {
    p.dispose();
  }
  merged.userData['shared'] = true;
  return merged;
}
