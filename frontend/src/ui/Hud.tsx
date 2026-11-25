import { useMemo, type ReactNode } from 'react';
import { useBoxStore } from '../client/box-store';
import { useInteractionStore } from '../client/interaction-store';
import type { SimClient } from '../client/sim-client';
import type { ContentDb, ResolvedMap } from '../content/index';
import { HudShell } from './HudShell';
import styles from './HudShell.module.css';
import type { HudContext, HudPanelGroups, HudSlot } from './hud-panels';

function defaultIsHostile(observer: number, faction: number): boolean {
  return faction !== 0 && faction !== observer;
}

export function Hud({
  client,
  db,
  map,
  isHostile,
  modeUi,
  panels,
}: {
  client: SimClient;
  db: ContentDb;
  map?: ResolvedMap | null | undefined;
  isHostile?: ((observer: number, faction: number) => boolean) | undefined;
  modeUi?: ReactNode | undefined;
  panels: HudPanelGroups;
}) {
  const primaryMode = useInteractionStore((s) => s.mode);
  const box = useBoxStore((s) => s.box);

  const ctx = useMemo<HudContext>(
    () => ({
      client,
      db,
      map: map ?? null,
      isHostile: isHostile ?? defaultIsHostile,
    }),
    [client, db, map, isHostile],
  );

  const renderSlot = (slot: HudSlot) =>
    panels[slot].map(({ id, Component }) => <Component key={id} ctx={ctx} />);

  return (
    <>
      <HudShell
        primaryMode={primaryMode}
        topLeft={renderSlot('topLeft')}
        topCenter={renderSlot('topCenter')}
        topRight={renderSlot('topRight')}
        middleLeft={renderSlot('middleLeft')}
        middleRight={renderSlot('middleRight')}
        bottomLeft={renderSlot('bottomLeft')}
        bottomCenter={renderSlot('bottomCenter')}
        bottomRight={renderSlot('bottomRight')}
      />
      {modeUi}
      {box !== null && (
        <div
          className={styles['marqueeBox']}
          style={{
            left: box.x0,
            top: box.y0,
            width: box.x1 - box.x0,
            height: box.y1 - box.y0,
          }}
        />
      )}
    </>
  );
}
