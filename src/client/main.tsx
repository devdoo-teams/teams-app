import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { app } from '@microsoft/teams-js';

import { App } from './App.js';
import { markTeamsHostReady } from './auth.js';
import './styles.css';

async function bootstrap(): Promise<void> {
  try {
    await app.initialize();
    markTeamsHostReady();
    document.documentElement.dataset.host = 'teams';
  } catch {
    // The local browser preview is intentionally usable outside Teams.
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
