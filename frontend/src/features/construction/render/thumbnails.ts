// Offscreen build-menu thumbnails (visual-languages HUD): renders each
// buildable structure's silhouette geometry once with a private
// WebGLRenderer + simple studio lighting, then disposes the renderer and
// all GPU objects. Returns data URLs the build cards show as images.
import * as THREE from 'three';
import type { ContentDb } from '../../../content/index';
import { createSilhouetteGeometries } from './structure-geometries';

const THUMB_SIZE = 72;

export function renderStructureThumbnails(
  db: ContentDb,
  bevel: number,
): ReadonlyMap<string, string> {
  const out = new Map<string, string>();
  const canvas = document.createElement('canvas');
  canvas.width = THUMB_SIZE;
  canvas.height = THUMB_SIZE;
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true,
  });
  renderer.setSize(THUMB_SIZE, THUMB_SIZE, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight('#cfe2f5', '#4a5240', 1.1));
  const sun = new THREE.DirectionalLight('#fff4dd', 2.2);
  sun.position.set(3, 5, 2.5);
  scene.add(sun);
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 50);
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.55,
    metalness: 0.15,
  });
  const geometries = createSilhouetteGeometries(bevel);
  const sphere = new THREE.Sphere();
  const mesh = new THREE.Mesh(undefined, material);
  scene.add(mesh);

  try {
    for (const kind of db.structures.list) {
      if (kind.build === undefined) {
        continue;
      }
      const geometry = geometries[kind.visual.silhouette];
      mesh.geometry = geometry;
      geometry.computeBoundingBox();
      geometry.boundingBox?.getBoundingSphere(sphere);
      // Footprint-scale so the thumbnail shows real proportions.
      const fp = Math.max(kind.footprint.w, kind.footprint.h);
      const scale = 1 / Math.max(fp, 0.5);
      mesh.scale.setScalar(scale);
      sphere.radius = Math.max(sphere.radius * scale, 0.001);
      const d = sphere.radius / Math.tan((camera.fov * Math.PI) / 360);
      camera.position.set(d * 0.95, d * 0.8, d * 0.95);
      camera.lookAt(0, sphere.center.y * 0.4, 0);
      renderer.render(scene, camera);
      out.set(kind.id, renderer.domElement.toDataURL('image/png'));
    }
  } finally {
    mesh.geometry = new THREE.BufferGeometry();
    for (const g of Object.values(geometries)) {
      g.dispose();
    }
    material.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
  }
  return out;
}
