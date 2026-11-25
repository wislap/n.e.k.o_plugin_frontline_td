// Vision inspector subject (ADR 0062 step 3): fog-of-war memory ghost.
// Moved verbatim from client/inspect-subject.ts and WorldObjectView.
import { useTranslation } from 'react-i18next';
import { localName, type ResolvedStructure } from '../../../content/index';
import { readChannel } from '../../../core/index';
import { structureStateName, type ConstructionStateName } from '../../construction/protocol';
import {
  defineInspectorSubject,
  indexOfHandle,
  inspectorStyles,
  type InspectorSubjectDef,
} from '../../../ui/inspector/index';
import { VisionMemoryChannel } from '../protocol';

const styles = inspectorStyles;

export interface MemoryView {
  kind: 'memory';
  handle: number;
  contentId: string;
  x: number;
  y: number;
  faction: number;
  stateName: ConstructionStateName;
  structure: ResolvedStructure | null;
}

const memory = defineInspectorSubject({
  kind: 'memory',
  inspects: false,
  hostile: false,
  resolve({ db, snapshot, subject }): MemoryView | null {
    const mem = readChannel(snapshot, VisionMemoryChannel) ?? undefined;
    const i = mem === undefined ? -1 : indexOfHandle(mem.handles, subject.handle);
    const kindIndex = i === -1 ? subject.kindIndex : (mem?.kind[i] ?? subject.kindIndex);
    const x = i === -1 ? subject.x : (mem?.x[i] ?? subject.x);
    const y = i === -1 ? subject.y : (mem?.y[i] ?? subject.y);
    const faction = i === -1 ? subject.faction : (mem?.faction[i] ?? subject.faction);
    const stateCode = i === -1 ? subject.state : (mem?.state[i] ?? subject.state);
    const structure = db.structures.byIndex(kindIndex) ?? null;
    return {
      kind: 'memory',
      handle: subject.handle,
      contentId: structure?.id ?? 'unknown',
      x,
      y,
      faction,
      stateName: structureStateName(stateCode),
      structure,
    };
  },
  title(view, t) {
    const name = localName(view.contentId);
    return t(`structure.${name}`, { defaultValue: name });
  },
  View({ view }) {
    const { t } = useTranslation();
    return (
      <div className={styles['metaRow']}>
        <span className={styles['tag']}>{t('inspector.fog_memory')}</span>
        <span className={styles['kvValue']}>
          {`${t(`state.${view.stateName}`, { defaultValue: view.stateName })} (${view.x}, ${view.y})`}
        </span>
      </div>
    );
  },
});

export const visionInspectorSubjects: readonly InspectorSubjectDef[] = [memory];
