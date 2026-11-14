import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';

export function App() {
  const { t } = useTranslation();

  useEffect(() => {
    document.title = t('app.title');
  }, [t]);

  return (
    <main>
      <h1>{t('app.title')}</h1>
      <p>{t('app.status')}</p>
    </main>
  );
}
