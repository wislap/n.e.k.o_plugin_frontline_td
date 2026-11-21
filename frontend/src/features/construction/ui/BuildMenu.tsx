// Build menu (ADR 0048, bottom centre): shown only in build primary
// mode (F2). Renders every buildable structure kind with localized name
// and cost, plus the [Demolish C] secondary tool toggle.
import { useTranslation } from 'react-i18next';
import { useInteractionStore } from '../../../client/interaction-store';
import { useIntentRouter } from '../../../client/intent';
import { localName, type ContentDb } from '../../../content/index';

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

export function BuildMenu({ db }: { db: ContentDb }) {
  const { t } = useTranslation();
  const router = useIntentRouter();
  const mode = useInteractionStore((s) => s.mode);
  const tool = useInteractionStore((s) => s.tool);

  if (mode !== 'build') {
    return null;
  }

  const buildables = db.structures.list.filter((s) => s.build !== undefined);
  const demolishing = tool.kind === 'demolish';

  return (
    <div style={menu}>
      {buildables.map((kind) => {
        const name = localName(kind.id);
        const cost = (kind.build?.cost ?? [])
          .map((c) => {
            const cargoId = db.cargos.byIndex(c.cargo)?.id ?? String(c.cargo);
            return `${Math.floor(c.milli / 1000)} ${t(`cargo.${localName(cargoId)}`, { defaultValue: localName(cargoId) })}`;
          })
          .join(', ');
        const selected = tool.kind === 'place' && tool.structureKindId === kind.id;
        return (
          <button
            key={kind.id}
            type="button"
            title={cost}
            onClick={() => {
              router.dispatch(
                selected ? { kind: 'tool.exit' } : { kind: 'build.select', kindId: kind.id },
              );
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
        title={t('build.demolish_hint')}
        onClick={() => {
          router.dispatch({ kind: 'demolish.press' });
        }}
        style={{
          cursor: 'pointer',
          padding: '4px 8px',
          border: demolishing ? '1px solid #ff8a7a' : '1px solid #555',
          background: demolishing ? 'rgba(255,138,122,0.25)' : 'rgba(30,30,30,0.9)',
          color: '#fff',
        }}
      >
        {t('build.demolish_button')}
        <div style={{ fontSize: 10, color: '#bbb' }}>{'C'}</div>
      </button>
    </div>
  );
}
