import { createRoot } from 'react-dom/client';
import { createElement } from 'react';
import { api } from './lib/api.js';
import DeviceManagementRoute from './components/DeviceManagementRoute.jsx';

const HASH = '#/device-management';
const DEVICE_HASH = /^#\/device\/\d+$/;
let role = null;
let navButton = null;
let mount = null;
let root = null;
let savedMainChildren = [];
let active = false;

function getMain() { return document.querySelector('main'); }
function isDeviceRoute() { return window.location.hash === HASH || DEVICE_HASH.test(window.location.hash); }

function enforceMain() {
  if (!active || !mount?.isConnected) return;
  const main = getMain();
  if (!main) return;
  [...main.children].forEach(node => { if (node !== mount) node.style.display = 'none'; });
}

function restoreMain() {
  const main = getMain();
  if (main) savedMainChildren.forEach(({ node, display }) => { if (node && node.isConnected) node.style.display = display; });
  savedMainChildren = [];
  if (mount?.isConnected) mount.remove();
  if (root) { root.unmount(); root = null; }
  mount = null;
  active = false;
  if (navButton) navButton.dataset.active = 'false';
}

function showPage() {
  const main = getMain();
  if (!main) return;
  if (active && mount?.isConnected) { enforceMain(); return; }
  restoreMain();
  savedMainChildren = [...main.children].map(node => ({ node, display: node.style.display }));
  savedMainChildren.forEach(({ node }) => { node.style.display = 'none'; });
  mount = document.createElement('div');
  mount.dataset.remoteopsDeviceManagement = 'true';
  mount.className = 'w-full';
  main.appendChild(mount);
  root = createRoot(mount);
  root.render(createElement(DeviceManagementRoute));
  active = true;
  if (navButton) navButton.dataset.active = 'true';
}

function syncRoute() {
  if (isDeviceRoute()) showPage();
  else if (active) restoreMain();
}

function getCurrentUser(response) {
  return response?.user || response || null;
}

function findSidebar() {
  const containers = [
    ...document.querySelectorAll('aside.sidebar, aside, [role="navigation"], nav')
  ];

  const matched = containers.find(container =>
    /Dashboard|User Management|Applications|Tickets/i.test(container.textContent || '')
  );

  if (matched) return matched;

  const menuButton = [...document.querySelectorAll('button, a')].find(el =>
    /^(Dashboard|User Management|Applications & Schedules|Tickets)$/i.test((el.textContent || '').trim())
  );

  return menuButton?.closest('aside, nav, [role="navigation"]') || null;
}

function addNavButton() {
  if (!role || !['Admin', 'Manager'].includes(role)) return;
  if (navButton?.isConnected) return;

  const nav = findSidebar();
  if (!nav) return;

  navButton = document.createElement('button');
  navButton.type = 'button';
  navButton.dataset.remoteopsDeviceManagementNav = 'true';
  navButton.className = 'nav-item w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-xs font-medium transition-all hover-surface text-muted';
  navButton.innerHTML = '<span class="text-base leading-none">▣</span><span>Device Management</span>';
  navButton.title = role === 'Manager' ? 'Device Management (Read-only)' : 'Device Management';

  navButton.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    window.location.hash = HASH;
    showPage();
  });

  const userButton = [...nav.querySelectorAll('button,a')].find(el =>
    /User Management/i.test(el.textContent || '')
  );
  const anchor = userButton?.closest('.nav-item') || userButton?.parentElement;

  if (anchor?.parentElement) {
    anchor.parentElement.insertAdjacentElement('afterend', navButton);
  } else {
    nav.appendChild(navButton);
  }
}

function hideEmbeddedDevicePanel() {
  document.querySelectorAll('.card').forEach(card => {
    if (card.closest('[data-remoteops-device-management]')) return;
    if (card.dataset.remoteopsEmbeddedDevicePanel === 'hidden') return;
    const heading = [...card.querySelectorAll('h3,h2,div')].find(el => (el.textContent || '').trim() === 'Device Management');
    if (heading) { card.dataset.remoteopsEmbeddedDevicePanel = 'hidden'; card.style.display = 'none'; }
  });
}

async function start() {
  try {
    const meResponse = await api.me();
    const me = getCurrentUser(meResponse);
    role = me?.role || null;
    addNavButton();
    hideEmbeddedDevicePanel();
    syncRoute();
  } catch (_) {}

  const observer = new MutationObserver(() => {
    addNavButton();
    hideEmbeddedDevicePanel();
    syncRoute();
    enforceMain();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('hashchange', syncRoute);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();

export {};
