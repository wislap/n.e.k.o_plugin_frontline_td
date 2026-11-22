// Inverted-hull edge outline (visual-slice stage 3): a second InstancedMesh
// sharing the source's instanceMatrix draws the same geometry slightly
// inflated along its normals with front faces culled, yielding a constant-
// width dark silhouette/contour line per instance. Enabled per theme via
// the debug-panel outline toggle; cheap bounded extra draw calls.
import * as THREE from 'three';

const INFLATE = 0.045;

export function createOutlineMaterial(color: string): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({
    color,
    side: THREE.BackSide,
    toneMapped: false,
  });
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
      transformed += normal * ${INFLATE};`,
    );
  };
  return m;
}

// Re-bind an outline instanced mesh to a source's buffers: same geometry
// transform data, count mirrored. Call inside useFrame after the source's
// matrices are written.
export function bindOutline(
  outline: THREE.InstancedMesh | null,
  source: THREE.InstancedMesh | null,
): void {
  if (outline === null || source === null) {
    return;
  }
  outline.instanceMatrix = source.instanceMatrix;
  outline.count = source.count;
  if (outline.geometry !== source.geometry) {
    // Share the source's geometry (structures assign theirs at runtime).
    outline.geometry = source.geometry;
  }
}
