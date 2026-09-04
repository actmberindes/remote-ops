/* Monitoring View: the enhancer owns the Live View UI so the legacy single-display React view never renders visibly. */

const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.1.2:4000/api';
const LIVE_REFRESH_MS = 5000;
const LIVE_SIZE_KEY = 'remoteops_live_tile_size';
const SCREENSHOT_SIZE_KEY = 'remoteops_screenshot_tile_size';
const STYLE_ID = 'remoteops-monitoring-view-style';
let liveTimer = null;
let liveRequestId = 0;
let latestLiveData = [];
const liveCardState = new WeakMap();

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

function getWindowsDisplayNumber(displayId) {
  const match = String(displayId || '').toUpperCase().match(/DISPLAY(\d+)$/);
  return match ? Number(match[1]) : null;
}

function isWindowsDisplayId(displayId) {
  return getWindowsDisplayNumber(displayId) !== null;
}

function displayLabel(display, fallbackIndex = 1) {
  const n = getWindowsDisplayNumber(display?.displayId);
  if (n !== null) return `\\\\.\\DISPLAY${n}`;
  return String(display?.displayName || `Display ${fallbackIndex}`);
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .remoteops-live-managed{visibility:hidden}
    .remoteops-live-managed[data-remoteops-ready="true"]{visibility:visible}
    .remoteops-live-root{width:100%}
    .remoteops-live-controls{display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px;margin:0 0 14px;width:100%}
    .remoteops-live-search{flex:1 1 240px;min-width:220px}
    .remoteops-live-filter{width:190px}
    .remoteops-live-control-label{display:block;margin:0 0 4px;color:var(--text-muted);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}
    .remoteops-live-input,.remoteops-live-select{width:100%;height:36px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);padding:0 10px;font-size:11px;font-weight:600;outline:none}
    .remoteops-live-input.search{padding-left:30px}
    .remoteops-live-search-wrap{position:relative}
    .remoteops-live-search-icon{position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--text-muted);font-size:13px;pointer-events:none}
    .remoteops-live-clear{height:36px;padding:0 12px;border:1px solid var(--border);border-radius:8px;background:transparent;color:var(--text-muted);font-size:11px;font-weight:800;cursor:pointer}
    .remoteops-live-clear:hover{color:var(--text)}
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
    .remoteops-display-grid{display:grid;gap:8px;padding:8px}
    .remoteops-display-grid.two-plus{grid-template-columns:repeat(2,minmax(0,1fr))}
    .remoteops-display-grid.one{grid-template-columns:minmax(0,1fr)}
    .remoteops-display-frame{min-width:0;border:1px solid var(--border);border-radius:10px;overflow:hidden;background:var(--bg)}
    .remoteops-display-canvas{position:relative;aspect-ratio:16/10;display:flex;align-items:center;justify-content:center;overflow:hidden;background:var(--bg)}
    .remoteops-display-image{width:100%;height:100%;object-fit:cover;display:block}
    .remoteops-display-empty{display:flex;flex-direction:column;align-items:center;gap:5px;color:var(--text-muted);font-size:9px}
    .remoteops-display-empty span:first-child{font-size:22px}
    .remoteops-display-name{position:absolute;right:7px;top:7px;padding:4px 7px;border-radius:999px;background:rgba(0,0,0,.72);color:#fff;font-size:8px;font-weight:800;max-width:72%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .remoteops-display-updated{padding:6px 8px;color:var(--text-muted);font-size:8px}
    .remoteops-monitor-empty{padding:24px 10px;border:1px dashed var(--border);border-radius:10px;color:var(--text-muted);font-size:10px;text-align:center}
    .remoteops-live-result-count{font-size:10px;color:var(--text-muted);font-weight:800;margin:0 0 7px}
    @media (max-width:700px){.remoteops-size-control span{display:none}.remoteops-size-control input{width:70px}.remoteops-display-grid.two-plus{grid-template-columns:1fr}.remoteops-live-filter{width:100%}}
  `;
  document.head.appendChild(style);
}

function findLiveViewCards() {
  return [...document.querySelectorAll('.card')].filter(card => {
    const content = textOf(card);
    return content.includes('Live Desktop View') || content.includes('Team Live View');
  });
}

function findScreenshotCard() {
  return [...document.querySelectorAll('.card')].find(card => {
    const content = textOf(card);
    return content.includes('Recent Screenshots') || (content.includes('Screenshots') && card.querySelector('img'));
  }) || null;
}

function getHeader(card) {
  const heading = [...card.querySelectorAll('h3')].find(h => /Live Desktop View|Team Live View|Screenshots|Recent Screenshots/i.test(textOf(h)));
  return heading?.parentElement?.parentElement || null;
}

function removeLegacyChildren(card, header) {
  if (!header) return;
  let child = header.nextElementSibling;
  while (child) {
    const next = child.nextElementSibling;
    child.remove();
    child = next;
  }
}

function stateFor(card) {
  let state = liveCardState.get(card);
  if (!state) {
    state = { query: '', employeeFilter: '', size: safeSize(localStorage.getItem(LIVE_SIZE_KEY), 300) };
    liveCardState.set(card, state);
  }
  return state;
}

function validDisplays(item) {
  const raw = Array.isArray(item?.displays) ? item.displays : [];
  return raw
    .filter(display => isWindowsDisplayId(display?.displayId))
    .sort((a, b) => (Number(a.displayIndex) || 999) - (Number(b.displayIndex) || 999));
}

function displayHtml(display, employeeName, fallbackIndex) {
  const imageUrl = uploadUrl(display?.frameUrl);
  const displayName = escapeHtml(displayLabel(display, fallbackIndex));
  const captured = display?.capturedAt ? new Date(display.capturedAt) : null;
  const updated = captured && !Number.isNaN(captured.getTime()) ? captured.toLocaleTimeString() : 'No frame';
  const image = imageUrl
    ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(employeeName)} — ${displayName}" class="remoteops-display-image" />`
    : `<div class="remoteops-display-empty"><span>▣</span><span>No recent frame</span></div>`;

  return `<div class="remoteops-display-frame">
    <div class="remoteops-display-canvas">
      ${image}
      <span class="remoteops-display-name">${displayName}</span>
    </div>
    <div class="remoteops-display-updated">Updated ${escapeHtml(updated)}</div>
  </div>`;
}

function employeeTileHtml(item) {
  const employeeName = item.employeeName || `Employee #${item.employeeId}`;
  const department = item.department || '—';
  const state = item.deviceStatus === 'idle' ? 'idle' : 'active';
  const displays = validDisplays(item);
  const gridClass = displays.length > 1 ? 'two-plus' : 'one';

  return `<div class="remoteops-live-employee-tile">
    <div class="remoteops-live-employee-heading">
      <div class="remoteops-live-employee-info">
        <div class="remoteops-live-employee-name">${escapeHtml(employeeName)}</div>
        <div class="remoteops-live-employee-meta">${escapeHtml(department)}${item.domainUser ? ` · ${escapeHtml(item.domainUser)}` : ''}</div>
        <div class="remoteops-live-employee-device">${escapeHtml(item.deviceName || item.hostname || 'Managed device')}</div>
      </div>
      <span class="remoteops-live-state" style="color:${state === 'idle' ? 'var(--warning)' : 'var(--success)'};border-color:${state === 'idle' ? 'var(--warning)' : 'var(--success)'}33">${state === 'idle' ? 'IDLE' : 'LIVE'}</span>
    </div>
    <div class="remoteops-display-grid ${gridClass}">
      ${displays.length > 0
        ? displays.map((display, index) => displayHtml(display, employeeName, index + 1)).join('')
        : '<div class="remoteops-monitor-empty">No physical display frames are currently available.</div>'}
    </div>
  </div>`;
}

function createControls(root, state, data, card) {
  const wrapper = document.createElement('div');
  wrapper.className = 'remoteops-live-controls';
  wrapper.dataset.remoteopsControls = 'true';

  const employees = [...data]
    .sort((a, b) => String(a.employeeName || '').localeCompare(String(b.employeeName || '')));

  const search = document.createElement('div');
  search.className = 'remoteops-live-search';
  search.innerHTML = `
    <label class="remoteops-live-control-label">Search</label>
    <div class="remoteops-live-search-wrap">
      <span class="remoteops-live-search-icon">⌕</span>
      <input class="remoteops-live-input search" data-remoteops-search placeholder="Search employee or device…" />
    </div>`;

  const searchInput = search.querySelector('input');
  searchInput.value = state.query;
  searchInput.addEventListener('input', () => {
    state.query = searchInput.value;
    renderCard(card, data, true);
  });

  const employee = document.createElement('div');
  employee.className = 'remoteops-live-filter';
  employee.innerHTML = `<label class="remoteops-live-control-label">Employee</label><select class="remoteops-live-select" data-remoteops-employee-filter><option value="">All Employees</option>${employees.map(item => `<option value="${escapeHtml(item.employeeId)}">${escapeHtml(item.employeeName || `Employee #${item.employeeId}`)}</option>`).join('')}</select>`;
  const employeeSelect = employee.querySelector('select');
  employeeSelect.value = state.employeeFilter;
  employeeSelect.addEventListener('change', () => {
    state.employeeFilter = employeeSelect.value;
    renderCard(card, data, true);
  });

  const clear = document.createElement('button');
  clear.type = 'button';
  clear.className = 'remoteops-live-clear';
  clear.textContent = 'Clear';
  clear.style.display = state.query || state.employeeFilter ? '' : 'none';
  clear.addEventListener('click', () => {
    state.query = '';
    state.employeeFilter = '';
    renderCard(card, data, true);
  });

  const size = document.createElement('label');
  size.className = 'remoteops-size-control';
  size.title = 'Adjust tile size';
  size.innerHTML = `<span>Size</span><input data-remoteops-live-size type="range" min="180" max="520" step="10" value="${state.size}" aria-label="Adjust Live View tile size" />`;
  const sizeInput = size.querySelector('input');
  sizeInput.addEventListener('input', () => {
    state.size = safeSize(sizeInput.value, 300);
    localStorage.setItem(LIVE_SIZE_KEY, String(state.size));
    renderCardGrid(card, data, state);
  });

  wrapper.append(search, employee, clear, size);
  root.appendChild(wrapper);
}

function filteredData(data, state) {
  const q = String(state.query || '').trim().toLowerCase();
  return data.filter(item => {
    if (state.employeeFilter && String(item.employeeId) !== String(state.employeeFilter)) return false;
    if (!q) return true;
    return [item.employeeName, item.department, item.deviceName, item.hostname, item.domainUser]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
      .includes(q);
  });
}

function renderCardGrid(card, data, state) {
  const root = card.querySelector('[data-remoteops-live-root]');
  if (!root) return;
  const oldSummary = root.querySelector('[data-remoteops-live-count]');
  const oldGrid = root.querySelector('[data-remoteops-live-grid]');
  oldSummary?.remove();
  oldGrid?.remove();

  const filtered = filteredData(data, state);
  const summary = document.createElement('div');
  summary.dataset.remoteopsLiveCount = 'true';
  summary.className = 'remoteops-live-result-count';
  const active = filtered.filter(item => item.deviceStatus === 'active').length;
  const idle = filtered.filter(item => item.deviceStatus === 'idle').length;
  summary.textContent = `${filtered.length} ${filtered.length === 1 ? 'employee' : 'employees'} reporting${active || idle ? ` · ${active} active${idle ? ` · ${idle} idle` : ''}` : ''}`;

  const grid = document.createElement('div');
  grid.dataset.remoteopsLiveGrid = 'true';
  grid.className = 'remoteops-live-grid';
  grid.innerHTML = filtered.length
    ? filtered.map(employeeTileHtml).join('')
    : '<div class="remoteops-monitor-empty">No employees match the current Live View filter.</div>';

  grid.style.gridTemplateColumns = `repeat(auto-fill,minmax(${state.size}px,1fr))`;
  root.append(summary, grid);
}

function renderCard(card, data, rebuildControls) {
  const header = getHeader(card);
  if (!header) return;
  const state = stateFor(card);
  removeLegacyChildren(card, header);
  let root = card.querySelector('[data-remoteops-live-root]');
  if (root && rebuildControls) root.remove();
  if (!root) {
    root = document.createElement('div');
    root.className = 'remoteops-live-root';
    root.dataset.remoteopsLiveRoot = 'true';
    createControls(root, state, data, card);
    card.appendChild(root);
  }
  renderCardGrid(card, data, state);
  card.classList.add('remoteops-live-managed');
  card.dataset.remoteopsReady = 'true';
}

async function refreshLiveView() {
  const cards = findLiveViewCards();
  if (!cards.length) return;
  const id = ++liveRequestId;
  try {
    const data = await getJson('/activity/live-view');
    if (id !== liveRequestId) return;
    latestLiveData = Array.isArray(data) ? data : [];
    cards.forEach(card => renderCard(card, latestLiveData, false));
  } catch (_) {
    // Keep the last successfully rendered multi-display view.
  }
}

function applyDefaultScreenshotDate(card) {
  const dateInput = card?.querySelector('input[type="date"]');
  if (!dateInput || dateInput.value || dateInput.dataset.remoteopsDefaultApplied === 'true') return;
  dateInput.dataset.remoteopsDefaultApplied = 'true';
  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  descriptor?.set?.call(dateInput, todayISO());
  dateInput.dispatchEvent(new Event('input', { bubbles: true }));
  dateInput.dispatchEvent(new Event('change', { bubbles: true }));
}

function enhanceScreenshots() {
  const card = findScreenshotCard();
  if (!card) return;
  applyDefaultScreenshotDate(card);
  const existing = card.querySelector('[data-remoteops-screenshot-size-control]');
  if (!existing) {
    const header = getHeader(card);
    if (header) {
      const wrapper = document.createElement('label');
      wrapper.className = 'remoteops-size-control';
      wrapper.dataset.remoteopsScreenshotSizeControl = 'true';
      wrapper.title = 'Adjust tile size';
      const current = safeSize(localStorage.getItem(SCREENSHOT_SIZE_KEY), 220);
      wrapper.innerHTML = `<span>Size</span><input type="range" min="180" max="520" step="10" value="${current}" aria-label="Adjust Screenshot tile size" />`;
      wrapper.querySelector('input')?.addEventListener('input', e => {
        const size = safeSize(e.target.value, 220);
        localStorage.setItem(SCREENSHOT_SIZE_KEY, String(size));
        const grid = [...card.querySelectorAll('.grid')].find(item => item.querySelectorAll('img').length > 0);
        if (grid) grid.style.gridTemplateColumns = `repeat(auto-fill,minmax(${size}px,1fr))`;
      });
      const controls = header.querySelector('.flex.items-center.gap-2:last-child') || header.lastElementChild;
      if (controls) controls.insertBefore(wrapper, controls.firstChild);
      else header.appendChild(wrapper);
    }
  }

  const size = safeSize(localStorage.getItem(SCREENSHOT_SIZE_KEY), 220);
  const grid = [...card.querySelectorAll('.grid')].find(item => item.querySelectorAll('img').length > 0);
  if (grid) {
    grid.dataset.remoteopsScreenshotGrid = 'true';
    grid.style.gridTemplateColumns = `repeat(auto-fill,minmax(${size}px,1fr))`;
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
  const cards = findLiveViewCards();
  for (const card of cards) {
    const header = getHeader(card);
    if (!header) continue;
    const root = card.querySelector('[data-remoteops-live-root]');
    if (!root) {
      card.classList.remove('remoteops-live-managed');
      card.style.visibility = 'hidden';
      renderCard(card, latestLiveData, false);
      card.style.visibility = '';
      continue;
    }

    let unexpected = false;
    let sibling = header.nextElementSibling;
    while (sibling) {
      if (sibling !== root) {
        unexpected = true;
        break;
      }
      sibling = sibling.nextElementSibling;
    }

    if (unexpected) {
      card.classList.remove('remoteops-live-managed');
      card.style.visibility = 'hidden';
      renderCard(card, latestLiveData, false);
      card.style.visibility = '';
    }
  }

  enhanceScreenshots();
});
observer.observe(document.body, { subtree: true, childList: true, characterData: true });
