import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import './admin-dashboard-ui.css';
import './asset-manager-assignment-enhancer.js';
import './admin-dashboard-ui-enhancer.js';
import './live-view-idle-enhancer.js';
import './live-view-smooth-enhancer.js';
import './monitoring-view-enhancer.js';
import './monitoring-rdp-label-enhancer.js';
import './live-view-fullscreen-enhancer.js';
import './screenshot-metadata-enhancer.js';
import './employee-idle-duration-enhancer.js';
import './screenshot-gallery-enhancer.js';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
