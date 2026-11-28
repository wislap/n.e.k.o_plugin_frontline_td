// Match-level selection pruning (ADR 0048, ADR 0062): subscribes to
// SimClient snapshots and drops handles that no longer exist in any
// selectable channel (units, structures, salvage, road segments),
// clearing on restart (snapshot === null).
import { pruneSelected, useSelectionStore } from '../client/selection-store';
import type { SimClient } from '../client/sim-client';
import { readChannel, type Snapshot } from '../core/index';
import {
  RoadWorksChannel,
  SalvageChannel,
  StructuresChannel,
} from '../features/construction/protocol';
import { DenseUnitsChannel } from '../features/units/protocol';

export function pruneSelectionFromSnapshot(snapshot: Snapshot | null): void {
  const store = useSelectionStore.getState();
  if (store.selected.size === 0) {
    return;
  }
  if (snapshot === null) {
    store.clear();
    return;
  }

  const valid = new Set<number>();
  const units = readChannel(snapshot, DenseUnitsChannel);
  if (units !== null) {
    for (let i = 0; i < units.handles.length; i++) {
      valid.add(units.handles[i] ?? 0);
    }
  }
  const structures = readChannel(snapshot, StructuresChannel);
  if (structures !== null) {
    for (let i = 0; i < structures.handles.length; i++) {
      valid.add(structures.handles[i] ?? 0);
    }
  }
  const salvage = readChannel(snapshot, SalvageChannel);
  if (salvage !== null) {
    for (let i = 0; i < salvage.handles.length; i++) {
      valid.add(salvage.handles[i] ?? 0);
    }
  }
  const roadWorks = readChannel(snapshot, RoadWorksChannel);
  if (roadWorks !== null) {
    for (let i = 0; i < roadWorks.segments.handles.length; i++) {
      valid.add(roadWorks.segments.handles[i] ?? 0);
    }
  }

  const pruned = pruneSelected(store.selected, valid);
  if (pruned.size !== store.selected.size) {
    useSelectionStore.setState({ selected: pruned });
  }
}

export function subscribeSelectionPruning(client: SimClient): () => void {
  pruneSelectionFromSnapshot(client.snapshots().latest);
  return client.subscribe(() => {
    pruneSelectionFromSnapshot(client.snapshots().latest);
  });
}
