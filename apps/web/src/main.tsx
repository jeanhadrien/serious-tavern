import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, NavLink, useLocation } from 'react-router-dom';
import { Chat } from './pages/Chat.js';
import { Workflows } from './pages/Workflows.js';
import { Settings } from './pages/Settings.js';
import { Presets } from './pages/Presets.js';
import { Characters, Personas } from './pages/Entities.js';
import { AlertsProvider } from './alerts/index.js';
import { Toaster } from './alerts/Toaster.js';
import '@xyflow/react/dist/style.css';
import './style.css';

const TAB_PATHS = ['/', '/workflows', '/presets', '/characters', '/personas', '/settings'];

function Tabs() {
  const { pathname } = useLocation();
  return (
    <main>
      {/* Every tab stays mounted and inactive tabs are only hidden, so switching
          tabs keeps each page's state: the open chat, workflow, preset, drafts
          and scroll position. */}
      <div className="tab-panel" hidden={pathname !== '/'}>
        <Chat />
      </div>
      <div className="tab-panel" hidden={pathname !== '/workflows'}>
        <Workflows />
      </div>
      <div className="tab-panel" hidden={pathname !== '/presets'}>
        <Presets />
      </div>
      <div className="tab-panel" hidden={pathname !== '/characters'}>
        <Characters />
      </div>
      <div className="tab-panel" hidden={pathname !== '/personas'}>
        <Personas />
      </div>
      <div className="tab-panel" hidden={pathname !== '/settings'}>
        <Settings />
      </div>
      {!TAB_PATHS.includes(pathname) && <Navigate to="/" replace />}
    </main>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AlertsProvider>
      <BrowserRouter>
        <div className="app">
          <nav>
            <strong>Serious Tavern</strong>
            <NavLink to="/" end>
              Chat
            </NavLink>
            <NavLink to="/workflows">Workflows</NavLink>
            <NavLink to="/presets">Presets</NavLink>
            <NavLink to="/characters">Characters</NavLink>
            <NavLink to="/personas">Personas</NavLink>
            <NavLink to="/settings">Settings</NavLink>
          </nav>
          <Tabs />
          <Toaster />
        </div>
      </BrowserRouter>
    </AlertsProvider>
  </React.StrictMode>,
);
