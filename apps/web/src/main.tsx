import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { Chat } from './pages/Chat.js';
import { Workflows } from './pages/Workflows.js';
import { Settings } from './pages/Settings.js';
import '@xyflow/react/dist/style.css';
import './style.css';

createRoot(document.getElementById('root')!).render(<React.StrictMode><BrowserRouter>
  <div className="app"><nav><strong>Serious Tavern</strong><NavLink to="/">Chat</NavLink>
    <NavLink to="/workflows">Workflows</NavLink><NavLink to="/settings">Settings</NavLink></nav>
    <main><Routes><Route path="/" element={<Chat />} /><Route path="/workflows" element={<Workflows />} />
      <Route path="/settings" element={<Settings />} /></Routes></main></div>
</BrowserRouter></React.StrictMode>);
