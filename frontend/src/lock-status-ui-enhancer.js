/* Safe Live View lock-status bridge.
 * Intentionally uses a bounded timer only. Do not use MutationObserver here:
 * Live View replaces its DOM during refreshes, and observing those mutations can
 * create a render -> mutation -> render loop that freezes the page.
 */

const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.1.2:4000/api';
const REFRESH_MS = 5000;
let timer = null;
let requestInFlight = false;

function getHeaders() {
  const token = localStorage.getItem('rw_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function getLiveView() {
  const response = await fetch(`${API_URL}/activity/live-view`, {
    headers: getHeaders(),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error(`Live View request failed (${response.status})`);
  return response.json();
}

function toneFor(state) {
  if (state === 'locked') return 'var(--danger)';
  if (state === 'idle') return 'var(--warning)';
  if (state === 'active') return 'var(--success)';
  return 'var(--neutral)';
}

function applyLiveLockState(items) {
  const byDevice = new Map(
    (Array.isArray(items) ? items : []).map(item => [String(item.deviceName || item.hostname || '').trim(), item])
  );

  document.querySelectorAll('.remoteops-live-employee-tile').forEach(tile => {
    const deviceName = tile.querySelector('.remoteops-live-employee-device')?.textContent?.trim() || '';
    const item = byDevice.get(deviceName);
    if (!item) return;

    const badge = tile.querySelector('.remoteops-live-state');
    if (!badge) return;

    const state = item.deviceStatus || 'active';
    const tone = toneFor(state);
    badge.textContent = state === 'locked' ? 'LOCKED' : state === 'idle' ? 'IDLE' : 'LIVE';
    badge.style.color = tone;
    badge.style.borderColor = `${tone}55`;

    tile.querySelectorAll('.remoteops-display-image').forEach(image => {
      image.style.display = state === 'locked' ? 'none' : 'block';
    });

    tile.querySelectorAll('.remoteops-display-canvas').forEach(canvas => {
      const existing = canvas.querySelector('[data-remoteops-locked-overlay]');
      if (state === 'locked') {
        if (!existing) {
          const overlay = document.createElement('div');
          overlay.dataset.remoteopsLockedOverlay = 'true';
          overlay.className = 'remoteops-display-empty';
          overlay.innerHTML = '<span>🔒</span><span>Workstation locked — Live View paused</span>';
          canvas.appendChild(overlay);
        }
      } else {
        existing?.remove();
      }
    });

    tile.querySelectorAll('.remoteops-display-updated').forEach(el => {
      if (state === 'locked') {
        el.textContent = 'Live capture paused while locked';
      } else if (item.capturedAt) {
        const captured = new Date(item.capturedAt);
        el.textContent = Number.isNaN(captured.getTime()) ? 'No frame' : `Updated ${captured.toLocaleTimeString()}`;
      }
    });
  });
}

async function refresh() {
  if (requestInFlight) return;
  requestInFlight = true;
  try {
    const items = await getLiveView();
    applyLiveLockState(items);
  } catch (_) {
    // The primary Live View enhancer owns normal refresh/error handling.
  } finally {
    requestInFlight = false;
  }
}

function start() {
  if (timer) return;
  refresh();
  timer = window.setInterval(refresh, REFRESH_MS);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}
