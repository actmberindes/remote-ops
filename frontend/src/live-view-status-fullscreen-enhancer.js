/* Live View status/count and full-screen image behavior.
   Kept separate from the existing monitoring renderer so Live View changes can
   be introduced without touching the large App.jsx file. */

const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.1.2:4000/api';
const REFRESH_MS = 5000;
const STYLE_ID = 'remoteops-live-status-fullscreen-style';
let timer = null;
let requestId = 0;
let overlay = null;

function textOf(el) {
  return (el?.textContent || '').replace(/\s+/g, ' ').trim();
}

function headers() {
  const token = localStorage.getItem('rw_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchLiveView() {
  const response = await fetch(`${API_URL}/activity/live-view`, { headers: headers() });
  if (!response.ok) throw new Error(`Live View request failed (${response.status})`);
  const data = await response.json();
  return Array.isArray(data) ? data : [];
}

function isLiveCard(card) {
  const content = textOf(card);
  return content.includes('Live Desktop View') || content.includes('Team Live View');
}

function liveCards() {
  return [...document.querySelectorAll('.card')].filter(isLiveCard);
}

function style() {
  if (document.getElementById(STYLE_ID)) return;
  const node = document.createElement('style');
  node.id = STYLE_ID;
  node.textContent = `
    .remoteops-display-image{cursor:zoom-in}
    .remoteops-live-fullscreen-overlay{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.88);backdrop-filter:blur(4px)}
    .remoteops-live-fullscreen-overlay img{display:block;max-width:96vw;max-height:94vh;width:auto;height:auto;object-fit:contain;border-radius:8px;box-shadow:0 20px 60px rgba(0,0,0,.45)}
    .remoteops-live-fullscreen-close{position:absolute;top:16px;right:18px;width:38px;height:38px;border:1px solid rgba(255,255,255,.2);border-radius:999px;background:rgba(0,0,0,.55);color:#fff;font-size:22px;line-height:1;cursor:pointer}
    .remoteops-live-fullscreen-meta{position:absolute;left:18px;bottom:16px;max-width:75vw;color:#fff;background:rgba(0,0,0,.55);border:1px solid rgba(255,255,255,.14);border-radius:8px;padding:7px 10px;font:600 11px/1.35 'Plus Jakarta Sans',sans-serif}
  `;
  document.head.appendChild(node);
}

function closeOverlay() {
  overlay?.remove();
  overlay = null;
}

function openOverlay(img) {
  const src = img?.currentSrc || img?.src;
  if (!src) return;
  closeOverlay();

  overlay = document.createElement('div');
  overlay.className = 'remoteops-live-fullscreen-overlay';
  overlay.innerHTML = `
    <button type="button" class="remoteops-live-fullscreen-close" aria-label="Close">×</button>
    <div class="remoteops-live-fullscreen-meta"></div>
    <img alt="" />
  `;
  overlay.querySelector('img').src = src;
  overlay.querySelector('.remoteops-live-fullscreen-meta').textContent = img.alt || 'Live View';
  overlay.addEventListener('click', event => {
    if (event.target === overlay || event.target.closest('.remoteops-live-fullscreen-close')) closeOverlay();
  });
  document.body.appendChild(overlay);
}

function updateStatusBadges(data) {
  const byEmployee = new Map(data.map(item => [String(item.employeeId), item]));

  liveCards().forEach(card => {
    const header = [...card.querySelectorAll('h3')].find(h => /Live Desktop View|Team Live View/i.test(textOf(h)))?.parentElement?.parentElement;
    if (!header) return;

    const badge = [...header.querySelectorAll('span')].find(node => /^\d+\s+(Active|Idle)$/i.test(textOf(node)));
    if (!badge) return;

    // For dashboard filters, rely on the rendered employee tiles when possible.
    // Otherwise use the organization/team feed directly.
    const employeeIds = [...card.querySelectorAll('.remoteops-live-employee-tile')]
      .map(tile => {
        const name = textOf(tile.querySelector('.remoteops-live-employee-name'));
        const item = data.find(entry => String(entry.employeeName || '') === name);
        return item ? String(item.employeeId) : null;
      })
      .filter(Boolean);

    const relevant = employeeIds.length > 0
      ? employeeIds.map(id => byEmployee.get(id)).filter(Boolean)
      : data;

    const active = relevant.filter(item => item.deviceStatus === 'active').length;
    const idle = relevant.filter(item => item.deviceStatus === 'idle').length;

    let label = '0 Active';
    if (active && !idle) label = `${active} Active`;
    else if (idle && !active) label = `${idle} Idle`;
    else if (active || idle) label = `${active} Active · ${idle} Idle`;

    badge.textContent = label;
    badge.setAttribute('title', `${active} active, ${idle} idle`);
  });
}

async function refresh() {
  const id = ++requestId;
  try {
    const data = await fetchLiveView();
    if (id !== requestId) return;
    updateStatusBadges(data);
  } catch (_) {
    // Keep the last known label during transient API failures.
  }
}

function installFullscreenListener() {
  if (document.body.dataset.remoteopsLiveFullscreenInstalled === 'true') return;
  document.body.dataset.remoteopsLiveFullscreenInstalled = 'true';
  document.addEventListener('click', event => {
    const img = event.target instanceof HTMLImageElement ? event.target.closest('.remoteops-display-image') : null;
    if (!img) return;
    event.preventDefault();
    event.stopPropagation();
    openOverlay(img);
  }, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && overlay) closeOverlay();
  });
}

style();
installFullscreenListener();
refresh();
timer = setInterval(refresh, REFRESH_MS);

a window.addEventListener('beforeunload', () => {
  if (timer) clearInterval(timer);
});
