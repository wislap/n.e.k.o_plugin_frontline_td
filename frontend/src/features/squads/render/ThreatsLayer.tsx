// Director threat layer (M4): pulsing gather markers with a member-count
// + countdown label for hostile gathering squads, and the stored route as
// an arrow polyline (threat colour) for gathers and launched waves.
import { useFrame } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import type { SimClient } from '../../../client/sim-client';
import { formatClock } from '../../../client/match-info';
import { terrainY } from '../../../render/world';
import { SquadsChannel, type SquadsSnapshot } from '../protocol';
import { arrowSpots, gatheringThreats, routedThreats } from './threat-info';
import { renderNowMs } from '../../../client/capture-mode';

const THREAT_COLOR = '#ff5a4a';
const MARKER_CAPACITY = 16;
const ARROW_CAPACITY = 256;
const ARROW_EVERY = 8;
const LABEL_W = 160;
const LABEL_H = 48;

interface LabelEntry {
  sprite: THREE.Sprite;
  canvas: HTMLCanvasElement;
  texture: THREE.CanvasTexture;
  text: string;
}

function makeLabel(): LabelEntry {
  const canvas = document.createElement('canvas');
  canvas.width = LABEL_W;
  canvas.height = LABEL_H;
  const texture = new THREE.CanvasTexture(canvas);
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true });
  const sprite = new THREE.Sprite(material);
  sprite.frustumCulled = false;
  sprite.scale.set(4, LABEL_H / (LABEL_W / 4), 1);
  return { sprite, canvas, texture, text: '' };
}

function drawLabel(entry: LabelEntry, text: string): void {
  const ctx = entry.canvas.getContext('2d');
  if (ctx === null) {
    return;
  }
  ctx.clearRect(0, 0, LABEL_W, LABEL_H);
  ctx.font = 'bold 28px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = THREAT_COLOR;
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.lineWidth = 4;
  ctx.strokeText(text, LABEL_W / 2, LABEL_H / 2 + 10);
  ctx.fillText(text, LABEL_W / 2, LABEL_H / 2 + 10);
  entry.texture.needsUpdate = true;
}

function getLineMaterial(ref: {
  current: THREE.LineBasicMaterial | null;
}): THREE.LineBasicMaterial {
  ref.current ??= new THREE.LineBasicMaterial({
    color: THREAT_COLOR,
    transparent: true,
    opacity: 0.7,
  });
  return ref.current;
}

export interface ThreatsLayerProps {
  client: SimClient;
  heights: ArrayLike<number>;
  mapWidth: number;
  mapHeight: number;
}

export function ThreatsLayer({ client, heights, mapWidth, mapHeight }: ThreatsLayerProps) {
  const groupRef = useRef<THREE.Group>(null);
  const markerRef = useRef<THREE.InstancedMesh>(null);
  const arrowRef = useRef<THREE.InstancedMesh>(null);
  const labels = useRef(new Map<number, LabelEntry>());
  const lines = useRef(new Map<number, { line: THREE.Line; sig: string }>());
  const lineMatRef = useRef<THREE.LineBasicMaterial | null>(null);
  const dummyRef = useRef(new THREE.Object3D());
  const coneDirRef = useRef(new THREE.Vector3());
  const upRef = useRef(new THREE.Vector3(0, 1, 0));
  const quatRef = useRef(new THREE.Quaternion());
  const seenLabelsRef = useRef(new Set<number>());
  const seenLinesRef = useRef(new Set<number>());
  const routeCoordsRef = useRef<number[]>([]);

  useEffect(() => {
    const labelMap = labels.current;
    const lineMap = lines.current;
    const group = groupRef.current;
    return () => {
      for (const entry of labelMap.values()) {
        group?.remove(entry.sprite);
        entry.sprite.material.dispose();
        entry.texture.dispose();
      }
      labelMap.clear();
      for (const entry of lineMap.values()) {
        group?.remove(entry.line);
        entry.line.geometry.dispose();
      }
      lineMap.clear();
      lineMatRef.current?.dispose();
      lineMatRef.current = null;
    };
  }, []);

  useFrame(() => {
    const group = groupRef.current;
    const markers = markerRef.current;
    const arrows = arrowRef.current;
    if (group === null || markers === null || arrows === null) {
      return;
    }
    const dummy = dummyRef.current;
    const coneGeometryDir = coneDirRef.current;
    const up = upRef.current;
    const quat = quatRef.current;
    const latest = client.snapshots().latest;
    const observer = latest?.observer ?? -1;
    const squads = (latest?.channels[SquadsChannel.id] as SquadsSnapshot | undefined)?.squads ?? [];
    const tick = latest?.tick ?? 0;
    const gathers = gatheringThreats(squads, observer);
    const routed = routedThreats(squads, observer);
    const pulse = 1 + 0.3 * Math.sin((renderNowMs() / 1000) * Math.PI * 2);

    // Gather markers + labels.
    const seenLabels = seenLabelsRef.current;
    seenLabels.clear();
    let m = 0;
    for (const squad of gathers) {
      if (m >= MARKER_CAPACITY) {
        break;
      }
      seenLabels.add(squad.id);
      const gy = terrainY(heights, mapWidth, mapHeight, squad.order.x, squad.order.y);
      dummy.position.set(squad.order.x, gy + 0.06, squad.order.y);
      // The ring geometry lies in the XY plane and is rotated flat
      // below, so local Y (not Z) carries the ground-plane scale.
      dummy.scale.set(pulse, pulse, 1);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.updateMatrix();
      markers.setMatrixAt(m, dummy.matrix);
      m += 1;

      let entry = labels.current.get(squad.id);
      if (entry === undefined) {
        entry = makeLabel();
        labels.current.set(squad.id, entry);
        group.add(entry.sprite);
      }
      const countdown =
        squad.order.launchTick !== undefined ? formatClock(squad.order.launchTick - tick) : '--:--';
      const text = `${squad.memberCount} · ${countdown}`;
      if (entry.text !== text) {
        entry.text = text;
        drawLabel(entry, text);
      }
      entry.sprite.position.set(squad.order.x, gy + 2.2, squad.order.y);
    }
    for (const [id, entry] of labels.current) {
      if (!seenLabels.has(id)) {
        group.remove(entry.sprite);
        entry.sprite.material.dispose();
        entry.texture.dispose();
        labels.current.delete(id);
      }
    }
    markers.count = m;
    markers.instanceMatrix.needsUpdate = true;

    // Route polylines + arrowheads.
    const seenLines = seenLinesRef.current;
    seenLines.clear();
    const positions = routeCoordsRef.current;
    let a = 0;
    for (const squad of routed) {
      const route = squad.route;
      if (route === undefined) {
        continue;
      }
      seenLines.add(squad.id);
      const sig = route.join(',');
      const entry = lines.current.get(squad.id);
      if (entry === undefined || entry.sig !== sig) {
        positions.length = 0;
        for (let i = 0; i + 3 < route.length; i += 2) {
          positions.push(
            route[i] ?? 0,
            terrainY(heights, mapWidth, mapHeight, route[i] ?? 0, route[i + 1] ?? 0) + 0.15,
            route[i + 1] ?? 0,
            route[i + 2] ?? 0,
            terrainY(heights, mapWidth, mapHeight, route[i + 2] ?? 0, route[i + 3] ?? 0) + 0.15,
            route[i + 3] ?? 0,
          );
        }
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        if (entry === undefined) {
          const line = new THREE.LineSegments(geometry, getLineMaterial(lineMatRef));
          line.frustumCulled = false;
          lines.current.set(squad.id, { line, sig });
          group.add(line);
        } else {
          entry.line.geometry.dispose();
          entry.line.geometry = geometry;
          entry.sig = sig;
        }
      }
      for (const spot of arrowSpots(route, ARROW_EVERY)) {
        if (a >= ARROW_CAPACITY) {
          break;
        }
        const len = Math.hypot(spot.dx, spot.dy);
        if (len < 0.001) {
          continue;
        }
        const gy = terrainY(heights, mapWidth, mapHeight, spot.x, spot.y);
        coneGeometryDir.set(spot.dx / len, 0, spot.dy / len);
        quat.setFromUnitVectors(up, coneGeometryDir);
        dummy.position.set(spot.x, gy + 0.4, spot.y);
        dummy.quaternion.copy(quat);
        dummy.scale.set(1, 1, 1);
        dummy.updateMatrix();
        arrows.setMatrixAt(a, dummy.matrix);
        a += 1;
      }
    }
    for (const [id, entry] of lines.current) {
      if (!seenLines.has(id)) {
        group.remove(entry.line);
        entry.line.geometry.dispose();
        lines.current.delete(id);
      }
    }
    arrows.count = a;
    arrows.instanceMatrix.needsUpdate = true;
  });

  return (
    <group ref={groupRef}>
      <instancedMesh
        ref={markerRef}
        args={[undefined, undefined, MARKER_CAPACITY]}
        frustumCulled={false}
      >
        <ringGeometry args={[0.6, 0.85, 24]} />
        <meshBasicMaterial
          color={THREAT_COLOR}
          transparent
          opacity={0.85}
          side={THREE.DoubleSide}
        />
      </instancedMesh>
      <instancedMesh
        ref={arrowRef}
        args={[undefined, undefined, ARROW_CAPACITY]}
        frustumCulled={false}
      >
        <coneGeometry args={[0.3, 0.8, 6]} />
        <meshBasicMaterial color={THREAT_COLOR} transparent opacity={0.85} />
      </instancedMesh>
    </group>
  );
}
