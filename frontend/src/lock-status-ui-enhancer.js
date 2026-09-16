const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.1.2:4000/api';
const REFRESH_MS = 5000;
let latestDevices = new Map();
let latestLive = new Map();
let timer = null;

function headers() {
  const token = localStorage.getItem('rw_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function getJson(path) {
  const response = await fetch(`${API_URL}${path}`, { headers: headers() });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}

function toneFor(state) {
  return state === 'locked' ? 'var(--danger)' : state === 'idle' ? 'var(--warning)' : state === 'active' ? 'var(--success)' : 'var(--neutral)';
}

function labelFor(state) {
  return ({
    active: 'Active',
    idle: 'Idle',
    locked: 'Locked',
    'logged-out': 'No User Logged In',
    offline: 'Offline',
    pending: 'Pending Enrollment',
    revoked: 'Revoked',
  })[state] || state || 'Unknown';
}

function deviceKeyFromRow(row) {
  const button = row.querySelector('td:first-child button');
  return button?.querySelector('.font-semibold')?.textContent?.trim() || '';
}

function applyDeviceManagement() {
  document.querySelectorAll('table tbody tr').forEach(row => {
    const deviceName = deviceKeyFromRow(row);
    if (!deviceName) return;
    const device = latestDevices.get(deviceName);
    if (!device) return;
    const statusCell = row.querySelector('td:nth-child(5)');
    const badge = statusCell?.querySelector('span.inline-flex');
    if (!badge) return;
    const tone = toneFor(device.status);
    badge.style.color = tone;
    badge.innerHTML = `<span class="rounded-full" style="width:7px;height:7px;background:${tone}"></span>${labelFor(device.status)}`;
  });
}

function applyLiveView() {
  document.querySelectorAll('.remoteops-live-employee-tile').forEach(tile => {
    const deviceName = tile.querySelector('.remoteops-live-employee-device')?.textContent?.trim() || '';
    const item = latestLive.get(deviceName);
    if (!item) return;
    const badge = tile.querySelector('.remoteops-live-state');
    if (!badge) return;
    const locked = item.deviceStatus === 'locked';
    const tone = toneFor(item.deviceStatus);
    badge.textContent = locked ? 'LOCKED' : item.deviceStatus === 'idle' ? 'IDLE' : 'LIVE';
    badge.style.color = tone;
    badge.style.borderColor = `${tone}55`;

    if (locked) {
      tile.querySelectorAll('.remoteops-display-image').forEach(img => img.style.display = 'none');
      tile.querySelectorAll('.remoteops-display-canvas').forEach(canvas => {
        if (canvas.querySelector('[data-remoteops-locked-overlay]')) return;
        const overlay = document.createElement('div');
        overlay.dataset.remoteopsLockedOverlay = 'true';
        overlay.className = 'remoteops-display-empty';
        overlay.innerHTML = '<span>🔒</span><span>Workstation locked — Live View paused</span>';
        canvas.appendChild(overlay);
      });
      tile.querySelectorAll('.remoteops-display-updated').forEach(el => { el.textContent = 'Live capture paused while locked'; });
    } else {
      tile.querySelectorAll('[data-remoteops-locked-overlay]').forEach(el => el.remove());
      tile.querySelectorAll('.remoteops-display-image').forEach(img => img.style.display = 'block');
    }
  });
}

async function refreshState() {
  try {
    const devices = await getJson('/agent/devices');
    latestDevices = new Map((Array.isArray(devices) ? devices : []).map(d => [String(d.deviceName || '').trim(), d]));
  } catch (_) {}

  try {
    const live = await getJson('/activity/live-view');
    latestLive = new Map((Array.isArray(live) ? live : []).map(item => [String(item.deviceName || item.hostname || '').trim(), item]));
  } catch (_) {}

  applyDeviceManagement();
  applyLiveView();
}

function start() {
  if (timer) return;
  refreshState();
  timer = setInterval(refreshState, REFRESH_MS);
  const observer = new MutationObserver(() => {
    applyDeviceManagement();
    applyLiveView();
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();
