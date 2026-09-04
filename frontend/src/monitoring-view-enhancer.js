/* Monitoring View enhancements: multi-display presentation + resizable tiles. */

const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.1.2:4000/api';
const LIVE_REFRESH_MS = 5000;
const LIVE_SIZE_KEY = 'remoteops_live_tile_size';
const SCREENSHOT_SIZE_KEY = 'remoteops_screenshot_tile_size';
const STYLE_ID = 'remoteops-monitoring-view-style';
let liveTimer = null;
let liveRequestId = 0;
let latestLiveData = [];
const liveFiltersWired = new WeakSet();

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

function todayISO() {
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function isWindowsDisplayId(value) {
  return /^\\\\\.\\DISPLAY\d+$/i.test(String(value || '').trim());
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .remoteops-size-control{display:inline-flex;align-items:center;gap:6px;margin-right:4px;color:var(--text-muted);font-size:9px;font-weight:800;white-space:nowrap}
    .remoteops-size-control input{width:82px;accent-color:var(--accent);cursor:pointer}
    .remoteops-live-grid{display:grid;gap:16px;width:100%}
    .remoteops-live-employee-tile{min-width:0;border:1px solid var(--border);border-radius:14px;overflow:hidden;background:var(--surface);box-shadow:0 5px 16px rgba(0,0,0,.06)}
    .remoteops-live-employee-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:11px 12px;border-bottom:1px solid var(--border);background:color-mix(in srgb,var(--surface) 92%,var(--bg) 8%)}
    .remoteops-live-employee-info{min-width:0}
    .remoteops-live-employee-name{font-size:12px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .remoteops-live-employee-meta,.remoteops-live-employee-device{margin-top:3px;color:var(--text-muted);font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .remoteops-live-employee-device{font-family:'JetBrains Mono',monospace}
    .remoteops-live-state{display:inline-flex;align-items:center;padding:4px 7px;border:1px solid;border-radius:999px;font-size:8px;font-weight:900;letter-spacing:.08em;flex-shrink:0}
    .remoteops-display-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;padding:8px}
    .remoteops-display-frame{min-width:0;border:1px solid var(--border);border-radius:10px;overflow:hidden;background:var(--bg)}
    .remoteops-display-canvas{position:relative;aspect-ratio:16/10;display:flex;align-items:center;justify-content:center;overflow:hidden;background:var(--bg)}
    .remoteops-display-image{width:100%;height:100%;object-fit:cover;display:block}
    .remoteops-display-empty{display:flex;flex-direction:column;align-items:center;gap:5px;color:var(--text-muted);font-size:9px}
    .remoteops-display-empty span:first-child{font-size:22px}
    .remoteops-display-name{position:absolute;right:7px;top:7px;padding:4px 7px;border-radius:999px;background:rgba(0,0,0,.72);color:#fff;font-size:8px;font-weight:800;max-width:68%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .remoteops-display-updated{padding:6px 8px;color:var(--text-muted);font-size:8px}
    .remoteops-monitor-empty{padding:24px 10px;border:1px dashed var(--border);border-radius:10px;color:var(--text-muted);font-size:10px;text-align:center}
    @media (max-width:700px){.remoteops-size-control span{display:none}.remoteops-size-control input{width:70px}.remoteops-display-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
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
    return content.includes('Recent Screenshots') || (content.includes('Screenshots') && card.querySelector('img'));
  }) || null;
}

function ensureSlider(card, type) {
  if (!card) return null;
  const key = type === 'live' ? LIVE_SIZE_KEY : SCREENSHOT_SIZE_KEY;
  const fallback = type === 'live' ? 300 : 220;
  const current = safeSize(localStorage.getItem(key), fallback);
  const id = `remoteops-${type}-size-control`;
  const existing = card.querySelector(`#${id}`);
  if (existing) {
    existing.value = String(current);
    return existing;
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
    const grid = card.querySelector('[data-remoteops-live-grid]');
    if (grid) grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${size}px, 1fr))`;
  } else {
    const grid = card.querySelector('[data-remoteops-screenshot-grid]') || [...card.querySelectorAll('.grid')].find(item => item.querySelectorAll('img').length > 0);
    if (grid) grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${size}px, 1fr))`;
  }
}

function getLiveControls(card) {
  const searchInput = card.querySelector('input[placeholder="Search employee or device…"]');
  const employeeSelect = [...card.querySelectorAll('select')].find(select => {
    const label = select.parentElement?.querySelector('label');
    return /Employee/i.test(textOf(label));
  });
  return { searchInput, employeeSelect };
}

function wireLiveFilters(card) {
  if (!card || liveFiltersWired.has(card)) return;
  const { searchInput, employeeSelect } = getLiveControls(card);
  const rerender = () => renderLiveView(latestLiveData, card);
  searchInput?.addEventListener('input', rerender);
  employeeSelect?.addEventListener('change', rerender);
  liveFiltersWired.add(card);
}

function validDisplays(item) {
  const displays = Array.isArray(item?.displays) ? item.displays : [];
  return displays
    .filter(display => isWindowsDisplayId(display?.displayId))
    .sort((a, b) => (Number(a.displayIndex) || 999) - (Number(b.displayIndex) || 999));
}

function displayHtml(display, employeeName) {
  const imageUrl = uploadUrl(display?.frameUrl);
  const displayName = escapeHtml(display?.displayName || String(display?.displayId || 'Display'));
  const captured = display?.capturedAt ? new Date(display.capturedAt) : null;
  const updated = captured && !Number.isNaN(captured.getTime()) ? captured.toLocaleTimeString() : 'No frame';
  const image = imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(employeeName)} — ${displayName}" class="remoteops-display-image" />`
    : `<div class="remoteops-display-empty"><span>▣</span><span>No recent frame</span></div>`;
  return `<div class="remoteops-display-frame">
    <div class="remoteops-display-canvas">${image}<span class="remoteops-display-name">${displayName}</span></div>
    <div class="remoteops-display-updated">Updated ${escapeHtml(updated)}</div>
  </div>`;
}

function employeeTileHtml(item) {
  const employeeName = item.employeeName || `Employee #${item.employeeId}`;
  const department = item.department || '—';
  const state = item.deviceStatus === 'idle' ? 'idle' : 'active';
  const displays = validDisplays(item);

  return `<div class="remoteops-live-employee-tile" data-remoteops-employee="${escapeHtml(employeeName)}">
    <div class="remoteops-live-employee-heading">
      <div class="remoteops-live-employee-info">
        <div class="remoteops-live-employee-name">${escapeHtml(employeeName)}</div>
        <div class="remoteops-live-employee-meta">${escapeHtml(department)}${item.domainUser ? ` · ${escapeHtml(item.domainUser)}` : ''}</div>
        <div class="remoteops-live-employee-device">${escapeHtml(item.deviceName || item.hostname || 'Managed device')}</div>
      </div>
      <span class="remoteops-live-state" style="color:${state === 'idle' ? 'var(--warning)' : 'var(--success)'};border-color:${state === 'idle' ? 'var(--warning)' : 'var(--success)'}33">${state === 'idle' ? 'IDLE' : 'LIVE'}</span>
    </div>
    <div class="remoteops-display-grid">${displays.length > 0
      ? displays.map(display => displayHtml(display, employeeName)).join('')
      : '<div class="remoteops-monitor-empty">No physical display frames are currently available.</div>'}</div>
  </div>`;
}

function renderLiveView(data, card) {
  if (!card) return;
  const { searchInput, employeeSelect } = getLiveControls(card);
  const query = String(searchInput?.value || '').trim().toLowerCase();
  const employeeId = String(employeeSelect?.value || '').trim();

  const filtered = data.filter(item => {
    if (employeeId && String(item.employeeId) !== employeeId) return false;
    if (!query) return true;
    const haystack = [
      item.employeeName,
      item.department,
      item.deviceName,
      item.hostname,
      item.domainUser,
    ].filter(Boolean).join(' ').toLowerCase();
    return haystack.includes(query);
  });

  let grid = card.querySelector('[data-remoteops-live-grid]');
  if (!grid) {
    grid = document.createElement('div');
    grid.dataset.remoteopsLiveGrid = 'true';
    grid.className = 'remoteops-live-grid';
    const existingGrids = [...card.querySelectorAll('.grid')];
    const target = existingGrids.find(candidate => candidate.querySelector('img')) || existingGrids[existingGrids.length - 1];
    if (target) target.replaceWith(grid);
    else card.appendChild(grid);
  }

  grid.innerHTML = filtered.length > 0
    ? filtered.map(employeeTileHtml).join('')
    : '<div class="remoteops-monitor-empty">No employees match the current Live View filter.</div>';

  const activeCount = filtered.filter(item => item.deviceStatus === 'active').length;
  const idleCount = filtered.filter(item => item.deviceStatus === 'idle').length;
  const badges = [...card.querySelectorAll('span')].filter(span => /^(\d+) Active(?: · (\d+) Idle)?$/.test(textOf(span)));
  if (badges[0]) badges[0].textContent = `${activeCount} Active${idleCount ? ` · ${idleCount} Idle` : ''}`;

  wireLiveFilters(card);
  const sizeInput = ensureSlider(card, 'live');
  applyGridSize(card, 'live', safeSize(sizeInput?.value, 300));
}

async function refreshLiveView() {
  const card = findLiveViewCard();
  if (!card) return;
  const id = ++liveRequestId;
  try {
    const data = await getJson('/activity/live-view');
    if (id !== liveRequestId) return;
    latestLiveData = Array.isArray(data) ? data : [];
    renderLiveView(latestLiveData, card);
  } catch (_) {
    // Preserve the existing React Live View if the enhancement has a transient error.
  }
}

function applyDefaultScreenshotDate(card) {
  if (!card || card.dataset.remoteopsDefaultDateApplied === 'true') return;
  const dateInput = card.querySelector('input[type="date"]');
  if (!dateInput) return;
  card.dataset.remoteopsDefaultDateApplied = 'true';

  if (dateInput.value) return;

  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  descriptor?.set?.call(dateInput, todayISO());
  dateInput.dispatchEvent(new Event('input', { bubbles: true }));
  dateInput.dispatchEvent(new Event('change', { bubbles: true }));
}

function enhanceScreenshots() {
  const card = findScreenshotCard();
  if (!card) return;
  applyDefaultScreenshotDate(card);
  const input = ensureSlider(card, 'screenshots');
  const size = safeSize(input?.value, 220, 180, 520);
  const grid = [...card.querySelectorAll('.grid')].find(item => item.querySelectorAll('img').length > 0);
  if (grid) {
    grid.dataset.remoteopsScreenshotGrid = 'true';
    grid.style.gridTemplateColumns = `repeat(auto-fill, minmax(${size}px, 1fr))`;
  }
}

function startLive() {
  if (liveTimer) return;
  refreshLiveView();
  liveTimer = setInterval(refreshLiveView, LIVE_REFRESH_MS);
}

injectStyles();
startLive();
enhanceScreenshots();
const observer = new MutationObserver(() => {
  if (findLiveViewCard()) startLive();
  enhanceScreenshots();
});
observer.observe(document.body, { subtree: true, childList: true, characterData: true });
