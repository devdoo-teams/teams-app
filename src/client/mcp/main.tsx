import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { McpGenUiWidget } from './McpGenUiWidget.js';

const root = document.getElementById('root');
if (!root) throw new Error('MCP GenUI widget root element is missing.');

createRoot(root).render(
  <StrictMode>
    <McpGenUiWidget />
  </StrictMode>,
);
