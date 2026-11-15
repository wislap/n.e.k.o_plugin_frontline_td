import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import type { SimClient } from '../client/sim-client';
import { useUiStore } from '../client/ui-store';
import { DebugPanel } from '../dev/DebugPanel';

export function App({ client }: { client: SimClient }) {
  const { t } = useTranslation();
  const panelOpen = useUiStore((state) => state.debugPanelOpen);

  useEffect(() => {
    document.title = t('app.title');
  }, [t]);

  return (
    <main>
      <h1>{t('app.title')}</h1>
      <p>{t('app.status')}</p>
      {panelOpen && <DebugPanel client={client} />}
    </main>
  );
}
