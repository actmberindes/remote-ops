/* Adds a clear RDP badge to Live View employee tiles based on the server's session telemetry. */

const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.1.2:4000/api';
const REFRESH_MS = 5000;
const STYLE_ID = 'remoteops-rdp-live-style';
let timer = null;
let requestInFlight = false;

function getHeaders() {
  const token = localStorage.getItem('rw_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function loadLiveData() {
  if (requestInFlight) return;
  requestInFlight = true;
  try {
    const response = await fetch(`${API_URL}/activity/live-view`, { headers: getHeaders() });
    if (!response.ok) return;
    const data = await response.json();
    applyRdpBadges(Array.isArray(data) ? data : []);
  } catch (_) {
    // The main monitoring enhancer handles the actual Live View refresh.
  } finally {
    requestInFlight = false;
  }
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .remoteops-rdp-badge{display:inline-flex;align-items:center;gap:5px;margin-left:6px;padding:3px 7px;border:1px solid color-mix(in srgb,var(--warning) 55%,transparent);border-radius:999px;background:color-mix(in srgb,var(--warning) 12%,transparent);color:var(--warning);font-size:8px;font-weight:900;letter-spacing:.08em;vertical-align:middle}
    .remoteops-rdp-badge::before{content:'↗';font-size:9px}
  `;
  document.head.appendChild(style);
}

function applyRdpBadges(data) {
  const byEmployee = new Map(data.map(item => [String(item.employeeId), item]));

  document.querySelectorAll('.remoteops-live-employee-tile').forEach(tile => {
    const nameNode = tile.querySelector('.remoteops-live-employee-name');
    if (!nameNode) return;

    const employeeName = nameNode.childNodes[0]?.textContent?.trim() || nameNode.textContent.trim();
    const item = [...byEmployee.values()].find(candidate => String(candidate.employeeName || '').trim() === employeeName);

    const old = nameNode.querySelector('.remoteops-rdp-badge');
    if (old) old.remove();
    tile.removeAttribute('data-remoteops-rdp');

    if (!item?.isRdp) return;

    const badge = document.createElement('span');
    badge.className = 'remoteops-rdp-badge';
    badge.textContent = 'RDP';
    badge.title = item.sessionName ? `Remote Desktop session: ${item.sessionName}` : 'Remote Desktop session';
    nameNode.appendChild(badge);
    tile.dataset.remoteopsRdp = 'true';
  });
}

function start() {
  injectStyles();
  if (timer) clearInterval(timer);
  loadLiveData();
  timer = setInterval(loadLiveData, REFRESH_MS);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}

export {};
