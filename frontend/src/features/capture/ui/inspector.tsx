// Capture inspector subject (ADR 0062 step 3): ruin view joined with
// CapturePointsChannel. Moved verbatim from client/inspect-subject.ts
// and the shell's WorldObjectView.
import { useTranslation } from 'react-i18next';
import { localName, type ResolvedStructure } from '../../../content/index';
import { readChannel } from '../../../core/index';
import { StructuresChannel } from '../../construction/protocol';
import { cx, MeterBar } from '../../../ui/kit/index';
import {
  defineInspectorSubject,
  indexOfHandle,
  inspectorStyles,
  type InspectorSubjectDef,
} from '../../../ui/inspector/index';
import { CapturePointsChannel } from '../protocol';

const styles = inspectorStyles;

export interface RuinView {
  kind: 'ruin';
  handle: number;
  contentId: string;
  x: number;
  y: number;
  structure: ResolvedStructure | null;
  progressBp: number;
  leader: number;
  owner: number;
  contested: boolean;
}

const ruin = defineInspectorSubject({
  kind: 'ruin',
  inspects: false,
  hostile: false,
  resolve({ db, snapshot, subject }): RuinView | null {
    const structures = readChannel(snapshot, StructuresChannel) ?? undefined;
    if (structures === undefined) {
      return null;
    }
    const i = indexOfHandle(structures.handles, subject.handle);
    if (i === -1) {
      return null;
    }
    const structure = db.structures.byIndex(structures.kind[i] ?? 0) ?? null;
    const contentId = structure?.id ?? 'unknown';
    const cp = readChannel(snapshot, CapturePointsChannel) ?? undefined;
    const ci = cp === undefined ? -1 : indexOfHandle(cp.handles, subject.handle);
    return {
      kind: 'ruin',
      handle: subject.handle,
      contentId,
      x: structures.x[i] ?? 0,
      y: structures.y[i] ?? 0,
      structure,
      progressBp: ci === -1 ? 0 : (cp?.progressBp[ci] ?? 0),
      leader: ci === -1 ? 0 : (cp?.leader[ci] ?? 0),
      owner: ci === -1 ? 0 : (cp?.owner[ci] ?? 0),
      contested: ci !== -1 && (cp?.contested[ci] ?? 0) !== 0,
    };
  },
  title(view, t) {
    const name = localName(view.contentId);
    return t(`structure.${name}_ruin`, {
      defaultValue: t(`structure.${name}`, { defaultValue: name }),
    });
  },
  View({ view }) {
    const { t } = useTranslation();
    return (
      <>
        <div className={styles['kvValue']}>{t('inspector.coords', { x: view.x, y: view.y })}</div>
        <MeterBar
          bp={view.progressBp}
          tone="mode"
          label={t('inspector.capture_label')}
          valueText={`${Math.round(view.progressBp / 100)}%`}
        />
        {view.contested && (
          <div className={styles['tagRow']}>
            <span className={cx(styles['tag'], styles['tagWarn'])}>{t('capture.contested')}</span>
          </div>
        )}
      </>
    );
  },
});

export const captureInspectorSubjects: readonly InspectorSubjectDef[] = [ruin];
