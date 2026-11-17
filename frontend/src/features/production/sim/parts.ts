// Spawn parts: kinds with a producer recipe get a Producer component.
import type { ResolvedStructure } from '../../../content/index';
import type { SpawnInit } from '../../../kernel/index';
import { Producer } from './components';

export function structureParts(kind: ResolvedStructure): SpawnInit {
  if (kind.producer === undefined) {
    return [];
  }
  return [[Producer, { kind: kind.index, progress: 0 }]];
}
