import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { resolveTheme } from '../../shared/theme';
import { App } from './App';
import { LockWindow } from './lock/LockWindow';
import { rememberedTheme } from './state/theme';
import './index.css';

// Paint the last known theme immediately (the lock screen cannot read settings yet).
document.documentElement.dataset['theme'] = resolveTheme(
  rememberedTheme(),
  window.matchMedia('(prefers-color-scheme: dark)').matches,
);

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element #root not found');
}

createRoot(root).render(
  <StrictMode>
    {new URLSearchParams(window.location.search).get('window') === 'lock' ? (
      <LockWindow />
    ) : (
      <App />
    )}
  </StrictMode>,
);
