// Terrain inspector subject (ADR 0062 step 3): the `cell` kind produces
// both the explored `cell` view and the `cell_unexplored` view. Moved
// verbatim from client/inspect-subject.ts and CellSubjectView.
import { useTranslation } from 'react-i18next';
import { localName } from '../../../content/index';
import { readChannel, readLayer } from '../../../core/index';
import { StructuresChannel } from '../../construction/protocol';
import { ROAD_LAYER_ID, SERVICE_LAYER_ID } from '../../logistics/protocol';
import { VISION_STATE_LAYER_ID, VisionMemoryChannel } from '../../vision/protocol';
import { hostileExcluders } from '../../vision/rules/index';
import {
  defineInspectorSubject,
  inspectorStyles,
  type InspectorSubjectDef,
} from '../../../ui/inspector/index';
import { TERRAIN_HEIGHT_LAYER_ID, TERRAIN_SURFACE_LAYER_ID } from '../protocol';

const styles = inspectorStyles;

export type CellView =
  | {
      kind: 'cell_unexplored';
      x: number;
      y: number;
    }
  | {
      kind: 'cell';
      x: number;
      y: number;
      visionState: 1 | 2;
      surfaceId: string | null;
      depositId: string | null;
      height: number;
      isRamp: boolean;
      roadLevel: number;
      covered: boolean;
      excluded: boolean;
    };

const cell = defineInspectorSubject({
  kind: 'cell',
  inspects: false,
  hostile: false,
  resolve({ db, map, snapshot, isHostile, subject }): CellView | null {
    if (map === null) {
      return null;
    }
    const observer = snapshot?.observer ?? 0;
    const { x, y } = subject;
    if (x < 0 || y < 0 || x >= map.width || y >= map.height) {
      return null;
    }
    const idx = y * map.width + x;
    const fogLayer = readLayer(snapshot, `${VISION_STATE_LAYER_ID}#${observer}`);
    if (fogLayer !== null && (fogLayer[idx] ?? 0) === 0) {
      return { kind: 'cell_unexplored', x, y };
    }
    const visionState: 1 | 2 = fogLayer !== null && (fogLayer[idx] ?? 0) === 1 ? 1 : 2;
    const surfaceLayer = readLayer(snapshot, TERRAIN_SURFACE_LAYER_ID);
    const surfaceIdx =
      surfaceLayer !== null ? (surfaceLayer[idx] ?? 0) : (map.grid.surfaces[idx] ?? 0);
    const surface = db.surfaces.byIndex(surfaceIdx);
    const depositId =
      surface?.deposit !== undefined ? (db.cargos.byIndex(surface.deposit)?.id ?? null) : null;

    const heightLayer = readLayer(snapshot, TERRAIN_HEIGHT_LAYER_ID);
    const height = heightLayer !== null ? (heightLayer[idx] ?? 0) : (map.grid.heights[idx] ?? 0);
    const isRamp = (map.grid.ramps[idx] ?? 0) !== 0;

    const roadLayer = readLayer(snapshot, ROAD_LAYER_ID);
    const roadLevel = roadLayer !== null ? (roadLayer[idx] ?? 0) : 0;

    const serviceLayer = readLayer(snapshot, `${SERVICE_LAYER_ID}#${observer}`);
    const covered = serviceLayer !== null ? (serviceLayer[idx] ?? 0) !== 0 : false;

    const structures = readChannel(snapshot, StructuresChannel) ?? undefined;
    const memory = readChannel(snapshot, VisionMemoryChannel) ?? undefined;
    const excluders = hostileExcluders(db, (faction) => isHostile(observer, faction), [
      structures,
      memory,
    ]);
    const excluded = excluders.some((e) => {
      const dx = x + 0.5 - e.cx;
      const dy = y + 0.5 - e.cy;
      return dx * dx + dy * dy <= e.r * e.r;
    });

    return {
      kind: 'cell',
      x,
      y,
      visionState,
      surfaceId: surface?.id ?? null,
      depositId,
      height,
      isRamp,
      roadLevel,
      covered,
      excluded,
    };
  },
  title(view, t) {
    return t('inspector.cell_coords', { x: view.x, y: view.y });
  },
  View({ view }) {
    const { t } = useTranslation();
    if (view.kind === 'cell_unexplored') {
      return <div className={styles['mutedText']}>{t('inspector.unexplored')}</div>;
    }
    const surfaceName = view.surfaceId !== null ? localName(view.surfaceId) : null;
    const surfaceLabel =
      surfaceName !== null
        ? t(`surface.${surfaceName}`, { defaultValue: surfaceName })
        : t('inspector.unknown');
    return (
      <>
        <div className={styles['tagRow']}>
          {view.visionState === 1 && (
            <span className={styles['tag']}>{t('inspector.fog_memory')}</span>
          )}
          <span className={styles['tag']}>{t('inspector.height', { h: view.height })}</span>
          {view.isRamp && <span className={styles['tag']}>{t('inspector.ramp')}</span>}
          {view.roadLevel > 0 && (
            <span className={styles['tag']}>
              {t('inspector.road_level', { level: view.roadLevel })}
            </span>
          )}
        </div>
        <div className={styles['kvRow']}>
          <span className={styles['kvLabel']}>
            {t('inspector.surface_label', { name: surfaceLabel })}
          </span>
        </div>
        {view.depositId !== null && (
          <div className={styles['warnText']}>
            {t('inspector.deposit', {
              cargo: t(`cargo.${localName(view.depositId)}`, {
                defaultValue: localName(view.depositId),
              }),
            })}
          </div>
        )}
        <div className={view.covered ? styles['accentText'] : styles['mutedText']}>
          {t(view.covered ? 'inspector.covered' : 'inspector.uncovered')}
        </div>
        {view.excluded && <div className={styles['dangerText']}>{t('inspector.hostile_zone')}</div>}
      </>
    );
  },
});

export const terrainInspectorSubjects: readonly InspectorSubjectDef[] = [cell];
