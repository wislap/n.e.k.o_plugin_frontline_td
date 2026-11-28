import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadContent } from '../../../content/index';
import { STRUCTURE_SILHOUETTES } from '../content';

const spyState = {
  throwInRender: false,
  throwInGeometries: false,
  rendererDispose: vi.fn(),
  rendererForceContextLoss: vi.fn(),
  rendererSetSize: vi.fn(),
  rendererRender: vi.fn(),
  materialDispose: vi.fn(),
  geoDispose: vi.fn(),
  sceneRemove: vi.fn(),
};

vi.mock('three', () => {
  class MockWebGLRenderer {
    domElement = { toDataURL: () => 'data:image/png;base64,mock' };
    setSize = spyState.rendererSetSize;
    render(...args: unknown[]) {
      spyState.rendererRender(...args);
      if (spyState.throwInRender) {
        throw new Error('render failed');
      }
    }
    dispose = spyState.rendererDispose;
    forceContextLoss = spyState.rendererForceContextLoss;
  }
  class MockScene {
    add = vi.fn();
    remove = spyState.sceneRemove;
  }
  class MockHemisphereLight {
    isHemisphereLight = true;
  }
  class MockDirectionalLight {
    position = { set: vi.fn() };
  }
  class MockPerspectiveCamera {
    fov = 30;
    position = { set: vi.fn() };
    lookAt = vi.fn();
  }
  class MockMeshStandardMaterial {
    dispose = spyState.materialDispose;
  }
  class MockSphere {
    center = { y: 0.5 };
    radius = 1;
  }
  class MockMesh {
    geometry: unknown;
    scale = { setScalar: vi.fn() };
    constructor(geometry: unknown) {
      this.geometry = geometry;
    }
  }
  return {
    WebGLRenderer: MockWebGLRenderer,
    Scene: MockScene,
    HemisphereLight: MockHemisphereLight,
    DirectionalLight: MockDirectionalLight,
    PerspectiveCamera: MockPerspectiveCamera,
    MeshStandardMaterial: MockMeshStandardMaterial,
    Sphere: MockSphere,
    Mesh: MockMesh,
  };
});

vi.mock('./structure-geometries', async () => {
  const actual =
    await vi.importActual<typeof import('./structure-geometries')>('./structure-geometries');
  const makeGeo = () => ({
    computeBoundingBox: vi.fn(),
    boundingBox: { getBoundingSphere: vi.fn() },
    dispose: spyState.geoDispose,
  });
  return {
    ...actual,
    createSilhouetteGeometries: () => {
      if (spyState.throwInGeometries) {
        throw new Error('geometry build failed');
      }
      return Object.fromEntries(STRUCTURE_SILHOUETTES.map((s) => [s, makeGeo()]));
    },
    disposeSilhouetteGeometries: (geos: Record<string, { dispose: () => void }>) => {
      for (const g of Object.values(geos)) {
        g.dispose();
      }
    },
  };
});

const { renderStructureThumbnails } = await import('./thumbnails');

describe('renderStructureThumbnails', () => {
  const db = loadContent();
  const buildableCount = db.structures.list.filter((s) => s.build !== undefined).length;

  beforeEach(() => {
    spyState.throwInRender = false;
    spyState.throwInGeometries = false;
    vi.clearAllMocks();
    vi.stubGlobal('document', {
      createElement: () => ({ width: 0, height: 0 }),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('renders one thumbnail per buildable structure and disposes all GPU resources', () => {
    const thumbs = renderStructureThumbnails(db);
    expect(thumbs.size).toBe(buildableCount);
    expect(spyState.rendererRender).toHaveBeenCalledTimes(buildableCount);
    expect(spyState.sceneRemove).toHaveBeenCalledTimes(1);
    expect(spyState.geoDispose).toHaveBeenCalledTimes(STRUCTURE_SILHOUETTES.length);
    expect(spyState.materialDispose).toHaveBeenCalledTimes(1);
    expect(spyState.rendererDispose).toHaveBeenCalledTimes(1);
    expect(spyState.rendererForceContextLoss).toHaveBeenCalledTimes(1);
  });

  it('cleans up GPU resources safely when rendering throws', () => {
    spyState.throwInRender = true;
    expect(() => renderStructureThumbnails(db)).toThrow('render failed');
    expect(spyState.sceneRemove).toHaveBeenCalledTimes(1);
    expect(spyState.geoDispose).toHaveBeenCalledTimes(STRUCTURE_SILHOUETTES.length);
    expect(spyState.materialDispose).toHaveBeenCalledTimes(1);
    expect(spyState.rendererDispose).toHaveBeenCalledTimes(1);
    expect(spyState.rendererForceContextLoss).toHaveBeenCalledTimes(1);
  });

  it('disposes material and renderer cleanly even when geometry creation throws before mesh exists', () => {
    spyState.throwInGeometries = true;
    expect(() => renderStructureThumbnails(db)).toThrow('geometry build failed');
    expect(spyState.sceneRemove).not.toHaveBeenCalled();
    expect(spyState.geoDispose).not.toHaveBeenCalled();
    expect(spyState.materialDispose).toHaveBeenCalledTimes(1);
    expect(spyState.rendererDispose).toHaveBeenCalledTimes(1);
    expect(spyState.rendererForceContextLoss).toHaveBeenCalledTimes(1);
  });
});
