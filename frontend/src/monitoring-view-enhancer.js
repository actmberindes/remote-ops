/* Monitoring View enhancements: multi-display presentation + resizable tiles. */

const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.1.2:4000/api';
const LIVE_REFRESH_MS = 5000;
const LIVE_SIZE_KEY = 'remoteops_live_tile_size';
const SCREENSHOT_SIZE_KEY = 'remoteops_screenshot_tile_size';
let liveTimer = null;
let liveRequestId = 0;

function textOf(el) {
  return (el?.textContent || '').replace(/\s+/g, ' ').trim();
}

function getHeaders() {
  const token = localStorage.getItem('rw_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function getJson(path) {
  const response = await fetch(`${API_URL}${path}`, { headers: getHeaders() });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}

function uploadUrl(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_URL.replace(/\/api\/?$/, '')}${url}`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function safeSize(value, fallback, min = 180, max = 520) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(max, Math.max(min, Math.round(numeric / 10) * 10));
}

function findLiveViewCard() {
  return [...document.querySelectorAll('.card')].find(card => {
    const content = textOf(card);
    return content.includes('Live Desktop View') || content.includes('Team Live View');
  }) || null;
}

function findScreenshotCard() {
  return [...document.querySelectorAll('.card')].find(card => {
    const content = textOf(card);
    return content.includes('Screenshots') || content.includes('Recent Screenshots');
  }) || null;
}

function ensureSlider(card, type) {
  if (!card) return null;
  const key = type === 'live' ? LIVE_SIZE_KEY : SCREENSHOT_SIZE_KEY;
  const fallback = type === 'live' ? 300 : 220;
  const current = safeSize(localStorage.getItem(key), fallback);
  const id = `remoteops-${type}-size-control`;
  if (document.getElementById(id)) {
    const slider = document.getElementById(id);
    slider.value = String(current);
    return slider;
  }

  const heading = [...card.querySelectorAll('h3')].find(h => /Live Desktop View|Team Live View|Screenshots|Recent Screenshots/i.test(textOf(h)));
  const header = heading?.parentElement?.parentElement || [...card.children].find(child => child.classList.contains('flex') && child.querySelector?.('h3'));
  if (!header) return null;

  const wrapper = document.createElement('label');
  wrapper.className = 'remoteops-size-control';
  wrapper.title = 'Adjust tile size';
  wrapper.innerHTML = `<span>Size</span><input id="${id}" type="range" min="180" max="520" step="10" value="${current}" aria-label="Adjust ${type === 'live' ? 'Live View' : 'Screenshot'} tile size" />`;

  const input = wrapper.querySelector('input');
  input.addEventListener('input', () => {
    const size = safeSize(input.value, fallback);
    localStorage.setItem(key, String(size));
    applyGridSize(card, type, size);
  });

  const controls = header.querySelector('.flex.items-center.gap-2:last-child') || header.lastElementChild;
  if (controls) controls.insertBefore(wrapper, controls.firstChild);
  else header.appendChild(wrapper);

  return input;
}

function applyGridSize(card, type, size) {
  if (!card) return;
  if (type === 'live') {
    const grid = card.querySelector('[data-remoteops-live-grid]') || [...card.querySelectorAll('.grid')].find(grid => grid.querySelector('.remoteops-live-employee-tile'));
    if (grid) grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${size}px, 1fr))`;
  } else {
    const grid = card.querySelector('[data-remoteops-screenshot-grid]') || [...card.querySelectorAll('.grid')].find(grid => {
      const images = grid.querySelectorAll('img');
      return images.length > 0;
    });
    if (grid) grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${size}px, 1fr))`;
  }
}

function displayHtml(display, state, employeeName) {
  const imageUrl = uploadUrl(display?.frameUrl);
  const displayName = escapeHtml(display?.displayName || `Display ${Number(display?.displayIndex) || 1}`);
  const captured = display?.capturedAt ? new Date(display.capturedAt) : null;
  const updated = captured && !Number.isNaN(captured.getTime()) ? captured.toLocaleTimeString() : 'No frame';
  const image = imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(employeeName)} — ${displayName}" class="remoteops-display-image" />`
    : `<div class="remoteops-display-empty"><span>▣</span><span>No recent frame</span></div>`;
  const label = state === 'idle' ? 'IDLE' : 'LIVE';
  const tone = state === 'idle' ? 'var(--warning)' : 'var(--success)';

  return `<div class="remoteops-display-frame">
    <div class="remoteops-display-canvas">
      ${image}
      <span class="remoteops-display-badge"><span class="remoteops-display-dot" style="background:${tone}"></span>${label}</span>
      <span class="remoteops-display-name">${displayName}</span>
    </div>
    <div class="remoteops-display-updated">Updated ${escapeHtml(updated)}</div>
  </div>`;
}

function employeeTileHtml(item) {
  const employeeName = item.employeeName || `Employee #${item.employeeId}`;
  const department = item.department || '—';
  const state = item.deviceStatus === 'idle' ? 'idle' : 'active';
  const displays = Array.isArray(item.displays) && item.displays.length > 0
    ? item.displays
    : [{ displayIndex: 1, displayName: 'Display 1', frameUrl: item.frameUrl, capturedAt: item.capturedAt }];

  return `<div class="remoteops-live-employee-tile" data-remoteops-employee="${escapeHtml(employeeName)}">
    <div class="remoteops-live-employee-heading">
      <div class="remoteops-live-employee-info">
        <div class="remoteops-live-employee-name">${escapeHtml(employeeName)}</div>
        <div class="remoteops-live-employee-meta">${escapeHtml(department)}${item.domainUser ? ` · ${escapeHtml(item.domainUser)}` : ''}</div>
        <div class="remoteops-live-employee-device">${escapeHtml(item.deviceName || item.hostname || 'Managed device')}</div>
      </div>
      <span class="remoteops-live-state" style="color:${state === 'idle' ? 'var(--warning)' : 'var(--success)'};border-color:${state === 'idle' ? 'var(--warning)' : 'var(--success)'}33">${state === 'idle' ? 'IDLE' : 'LIVE'}</span>
    </div>
    <div class="remoteops-display-grid">${displays.map(display => displayHtml(display, state, employeeName)).join('')}</div>
  </div>`;
}

async function refreshLiveView() {
  const card = findLiveViewCard();
  if (!card) return;
  const id = ++liveRequestId;
  try {
    const data = await getJson('/activity/live-view');
    if (id !== liveRequestId) return;

    let grid = card.querySelector('[data-remoteops-live-grid]');
    if (!grid) {
      grid = document.createElement('div');
      grid.dataset.remoteopsLiveGrid = 'true';
      grid.className = 'remoteops-live-grid';
      const existingGrids = [...card.querySelectorAll('.grid')];
      const target = existingGrids.find(candidate => candidate.querySelector('img')) || existingGrids[existingGrids.length - 1];
      if (target) {
        target.replaceWith(grid);
      } else {
        card.appendChild(grid);
      }
    }

    grid.innerHTML = data.length > 0
      ? data.map(employeeTileHtml).join('')
      : '<div class="remoteops-monitor-empty">No employees are currently reporting.</div>';

    const activeCount = data.filter(item => item.deviceStatus === 'active').length;
    const idleCount = data.filter(item => item.deviceStatus === 'idle').length;
    const badges = [...card.querySelectorAll('span')].filter(span => /^\d+ Active(?: · \d+ Idle)?$/.test(textOf(span)));
    badges[0]?.replaceChildren(document.createTextNode(`${activeCount} Active${idleCount ? ` · ${idleCount} Idle` : ''}`));

    const sizeInput = ensureSlider(card, 'live');
    applyGridSize(card, 'live', safeSize(sizeInput?.value, 300));
  } catch (_) {
    // Preserve the existing React Live View if the enhancement has a transient error.
  }
}

function enhanceScreenshots() {
  const card = findScreenshotCard();
  if (!card) return;
  const input = ensureSlider(card, 'screenshots');
  applyGridSize(card, 'screenshots', safeSize(input?.value, 220, 180, 520));
}

function startLive() {
  if (liveTimer) return;
  refreshLiveView();
  liveTimer = setInterval(refreshLiveView, LIVE_REFRESH_MS);
}

const observer = new MutationObserver(() => {
  if (findLiveViewCard()) startLive();
  enhanceScreenshots();
});

observer.observe(document.body, { subtree: true, childList: true, characterData: true });
startLive();
enhanceScreenshots();
