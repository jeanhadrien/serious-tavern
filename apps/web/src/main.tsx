import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { Chat } from './pages/Chat.js';
import { Workflows } from './pages/Workflows.js';
import { Settings } from './pages/Settings.js';
import { Presets } from './pages/Presets.js';
import { Characters, Personas } from './pages/Entities.js';
import { AlertsProvider } from './alerts/index.js';
import { Toaster } from './alerts/Toaster.js';
import '@xyflow/react/dist/style.css';
import './style.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AlertsProvider>
      <BrowserRouter>
        <div className="app">
          <nav>
            <strong>Serious Tavern</strong>
            <NavLink to="/">Chat</NavLink>
            <NavLink to="/workflows">Workflows</NavLink>
            <NavLink to="/presets">Presets</NavLink>
            <NavLink to="/characters">Characters</NavLink>
            <NavLink to="/personas">Personas</NavLink>
            <NavLink to="/settings">Settings</NavLink>
          </nav>
          <main>
            <Routes>
              <Route path="/" element={<Chat />} />
              <Route path="/workflows" element={<Workflows />} />
              <Route path="/presets" element={<Presets />} />
              <Route path="/characters" element={<Characters />} />
              <Route path="/personas" element={<Personas />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </main>
          <Toaster />
        </div>
      </BrowserRouter>
    </AlertsProvider>
  </React.StrictMode>,
);
