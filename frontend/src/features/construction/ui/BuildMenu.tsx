// Build menu (M3 D, bottom centre): every buildable structure kind with
// a localized name and its materialized cost. Clicking selects the kind
// into the build store; Esc or right-click leaves build mode.
import { useTranslation } from 'react-i18next';
import { useBuildStore } from '../../../client/build-store';
import type { ContentDb } from '../../../content/index';

const menu = {
  position: 'fixed',
  bottom: 8,
  left: '50%',
  transform: 'translateX(-50%)',
  display: 'flex',
  gap: 6,
  padding: '6px 8px',
  background: 'rgba(0,0,0,0.55)',
  fontFamily: 'monospace',
  fontSize: 12,
  zIndex: 900,
  borderRadius: 4,
} as const;

function cargoName(id: string): string {
  return id.split(':')[1] ?? id;
}

export function BuildMenu({ db }: { db: ContentDb }) {
  const { t } = useTranslation();
  const active = useBuildStore((s) => s.kind);
  const roadMode = useBuildStore((s) => s.roadMode);
  const buildables = db.structures.list.filter((s) => s.build !== undefined);

  return (
    <div style={menu}>
      {buildables.map((kind) => {
        const name = kind.id.split(':')[1] ?? kind.id;
        const cost = (kind.build?.cost ?? [])
          .map((c) => {
            const cargoId = db.cargos.byIndex(c.cargo)?.id ?? String(c.cargo);
            return `${Math.floor(c.milli / 1000)} ${t(`cargo.${cargoName(cargoId)}`, { defaultValue: cargoName(cargoId) })}`;
          })
          .join(', ');
        const selected = active === kind.id;
        return (
          <button
            key={kind.id}
            type="button"
            title={cost}
            onClick={() => {
              if (selected) {
                useBuildStore.getState().cancel();
              } else {
                useBuildStore.getState().select(kind.id);
              }
            }}
            style={{
              cursor: 'pointer',
              padding: '4px 8px',
              border: selected ? '1px solid #7fd4ff' : '1px solid #555',
              background: selected ? 'rgba(127,212,255,0.25)' : 'rgba(30,30,30,0.9)',
              color: '#fff',
            }}
          >
            {t(`structure.${name}`, { defaultValue: name })}
            <div style={{ fontSize: 10, color: '#bbb' }}>{cost}</div>
          </button>
        );
      })}
      <button
        type="button"
        title={t('road.button_hint')}
        onClick={() => {
          const store = useBuildStore.getState();
          if (store.roadMode) {
            store.cancel();
          } else {
            store.enterRoad();
          }
        }}
        style={{
          cursor: 'pointer',
          padding: '4px 8px',
          border: roadMode ? '1px solid #ffd166' : '1px solid #555',
          background: roadMode ? 'rgba(255,209,102,0.25)' : 'rgba(30,30,30,0.9)',
          color: '#fff',
        }}
      >
        {t('road.button')}
        <div style={{ fontSize: 10, color: '#bbb' }}>R</div>
      </button>
    </div>
  );
}
