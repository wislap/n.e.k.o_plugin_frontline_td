import { createRoot } from 'react-dom/client';
import '../i18n';
import { App } from './App';

const container = document.getElementById('root');
if (container === null) {
  throw new Error('missing #root element');
}

createRoot(container).render(<App />);
