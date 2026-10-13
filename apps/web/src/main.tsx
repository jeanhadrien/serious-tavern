import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AlertsProvider } from './alerts/index.js';
import { Toaster } from './alerts/Toaster.js';
import { Shell } from './layout/Shell.js';
import '@xyflow/react/dist/style.css';
import './style.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AlertsProvider>
      <BrowserRouter>
        <Shell />
        <Toaster />
      </BrowserRouter>
    </AlertsProvider>
  </React.StrictMode>,
);
