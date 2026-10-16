import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';

// Paint the OS theme immediately; the saved preference replaces it once settings load.
document.documentElement.dataset['theme'] = window.matchMedia('(prefers-color-scheme: dark)')
  .matches
  ? 'dark'
  : 'light';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Root element #root not found');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
