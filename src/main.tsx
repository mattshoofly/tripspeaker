import '@fontsource-variable/geist';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/layout.css';
import './styles/room.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { installDiagnosticsHook } from './session/app';

installDiagnosticsHook();

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root');

async function boot(container: HTMLElement) {
  const fixture = import.meta.env.DEV ? new URLSearchParams(location.search).get('fixture') : null;
  if (fixture) {
    const { FixtureApp } = await import('./fixtures/FixtureApp');
    createRoot(container).render(
      <StrictMode>
        <FixtureApp name={fixture} />
      </StrictMode>,
    );
    return;
  }
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void boot(root);
