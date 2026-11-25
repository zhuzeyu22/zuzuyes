import React from 'react';
import { createRoot } from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App.jsx';
import './styles/global.css';

const saved = (() => {
  try { return localStorage.getItem('algo-atlas-theme'); } catch { return null; }
})();
if (saved === 'dark' || saved === 'light') {
  document.documentElement.setAttribute('data-theme', saved);
}

createRoot(document.getElementById('root')).render(
  <HashRouter>
    <App />
  </HashRouter>
);
