import '@/core/polyfills';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './app/App';
import './styles/base.css';

// Restore the chosen ambient before first paint so there is no flash.
try {
  const saved = localStorage.getItem('pa:theme');
  if (saved === 'press') document.documentElement.dataset.theme = 'press';
} catch {
  /* private mode */
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
