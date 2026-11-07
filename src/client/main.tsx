import { StrictMode } from 'react';
import { createRoot, hydrateRoot } from 'react-dom/client';
import '@fontsource-variable/fredoka';
import '@fontsource-variable/nunito';
import { App } from './App';
import { screenFromUrl } from './screens';
import './styles.css';

const root = document.getElementById('root')!;
const app = (
  <StrictMode>
    <App />
  </StrictMode>
);

// index.html ships with the home page pre-rendered (see scripts/prerender.mjs).
// Reuse that markup on the home page; any other screen starts fresh.
if (root.hasChildNodes() && screenFromUrl().kind === 'home') {
  hydrateRoot(root, app);
} else {
  root.textContent = '';
  createRoot(root).render(app);
}
