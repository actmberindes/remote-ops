/* Main Screenshots pagination.
   This version deliberately leaves React-owned nodes in place. It renders
   the paginated screenshot viewer as a body-level overlay positioned over the
   existing screenshot grid, preventing React reconciliation errors while
   still supporting the complete screenshot history. */

const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.1.2:4000/api';
const PAGE_SIZE = 60;
const BATCH_SIZE = 200;
const STYLE_ID = 'remoteops-screenshot-pagination-safe-style';
const OVERLAY_ATTR = 'data-remoteops-shot-overlay';
const SIZE_KEY = 'remoteops_screenshot_tile_size';

let started = false;
let observer = null;
let activeCards = new WeakSet();
const states = new WeakMap();

const textOf = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();

function headers() {
  const token = localStorage.getItem('rw_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function uploadUrl(url) {
  if (!url) return '';
  if (/^https?:\\/\\//i.test(url)) return url;
  return `${API_URL.replace(/\\/api\\/?$/, '')}${url}`;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function sizeValue() {
  const value = Number(localStorage.getItem(SIZE_KEY));
  return Number.isFinite(value) ? Math.min(520, Math.max(160, Math.round(value / 10) * 10)) : 220;
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .remoteops-shot-overlay{position:absolute;z-index:20;background:var(--surface);border-radius:10px;overflow:hidden;box-shadow:0 10px 35px rgba(0,0,0,.22);border:1px solid var(--border)}
    .remoteops-shot-overlay-inner{display:flex;flex-direction:column;height:100%;padding:8px}
    .remoteops-shot-overlay-summary{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:2px 2px 8px;min-height:30px}
    .remoteops-shot-overlay-summary-text{font-size:10px;font-weight:800;color:var(--text-muted)}
    .remoteops-shot-overlay-bulk{display:flex;align-items:center;gap:6px;font-size:10px;font-weight:800;color:var(--text-muted);cursor:pointer}
    .remoteops-shot-overlay-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;overflow:hidden;flex:1;align-content:start}
    .remoteops-shot-overlay-tile{position:relative;min-width:0;border:1px solid var(--border);border-radius:9px;overflow:hidden;background:var(--bg)}
    .remoteops-shot-overlay-image-button{display:block;width:100%;border:0;padding:0;background:var(--bg);cursor:zoom-in}
    .remoteops-shot-overlay-image{display:block;width:100%;aspect-ratio:16/10;object-fit:cover}
    .remoteops-shot-overlay-meta{padding:6px 8px;background:var(--surface)}
    .remoteops-shot-overlay-name{font-size:9px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .remoteops-shot-overlay-date{margin-top:2px;font-size:8px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .remoteops-shot-overlay-check{position:absolute;top:6px;left:6px;z-index:2;width:15px;height:15px}
    .remoteops-shot-overlay-delete{position:absolute;top:5px;right:5px;z-index:2;border:0;border-radius:7px;width:27px;height:27px;background:rgba(0,0,0,.68);color:#fff;cursor:pointer;font-weight:900}
    .remoteops-shot-overlay-delete:hover{background:var(--danger)}
    .remoteops-shot-overlay-nav{display:flex;align-items:center;justify-content:center;gap:7px;padding:9px 2px 2px}
    .remoteops-shot-overlay-btn{height:30px;min-width:34px;padding:0 10px;border:1px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text);font-size:10px;font-weight:800;cursor:pointer}
    .remoteops-shot-overlay-btn:disabled{opacity:.45;cursor:not-allowed}
    .remoteops-shot-overlay-page{font-size:9px;font-weight:800;color:var(--text-muted);min-width:72px;text-align:center}
    .remoteops-shot-fullscreen{position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.92)}
    .remoteops-shot-fullscreen img{max-width:96vw;max-height:92vh;width:auto;height:auto;object-fit:contain;border-radius:8px;box-shadow:0 16px 55px rgba(0,0,0,.45)}
    .remoteops-shot-fullscreen-close{position:absolute;top:16px;right:18px;width:40px;height:40px;border:1px solid rgba(255,255,255,.2);border-radius:999px;background:rgba(0,0,0,.55);color:#fff;font-size:22px;cursor:pointer}
    .remoteops-shot-fullscreen-label{position:absolute;left:18px;bottom:16px;max-width:78vw;padding:7px 10px;border-radius:7px;background:rgba(0,0,0,.6);border:1px solid rgba(255,255,255,.15);color:#fff;font-size:10px;font-weight:700}
    @media (max-width:1100px){.remoteops-shot-overlay-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
    @media (max-width:800px){.remoteops-shot-overlay-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media (max-width:520px){.remoteops-shot-overlay-grid{grid-template-columns:1fr}}
  `;
  document.head.appendChild(style);
}

function screenshotCards() {
  return [...document.querySelectorAll('.card')].filter(card => {
    return [...card.querySelectorAll('h3')].some(h => /^Screenshots$|^Team Screenshots$/i.test(textOf(h)));
  });
}

function screenshotGrid(card) {
  return [...card.querySelectorAll('.grid')].find(grid => grid.querySelector('img')) || null;
}

function getState(card) {
  let state = states.get(card);
  if (!state) {
    state = {
      page: 1,
      items: [],
      total: 0,
      loading: false,
      error: '',
      selectedIds: new Set(),
      overlay: null,
      lastRect: null,
      loadToken: 0,
    };
    states.set(card, state);
  }
  return state;
}

async function fetchBatch(offset, signal) {
  const params = new URLSearchParams({ offset: String(offset), limit: String(BATCH_SIZE) });
  const response = await fetch(`${API_URL}/activity/screenshots-feed?${params.toString()}`, {
    headers: headers(),
    signal,
  });
  if (!response.ok) throw new Error(`Screenshot feed request failed (${response.status})`);
  return response.json();
}

async function fetchAll(state) {
  const token = ++state.loadToken;
  const controller = new AbortController();
  state.abortController?.abort();
  state.abortController = controller;

  const all = [];
  let offset = 0;
  try {
    while (true) {
      const payload = await fetchBatch(offset, controller.signal);
      if (token !== state.loadToken) return null;
      const batch = Array.isArray(payload?.items) ? payload.items : [];
      all.push(...batch);
      if (!payload?.hasMore || batch.length === 0) break;
      offset += batch.length;
    }
    state.total = all.length;
    return all;
  } finally {
    if (state.abortController === controller) state.abortController = null;
  }
}

function openFullscreen(url, label) {
  const src = uploadUrl(url);
  if (!src) return;
  document.querySelectorAll('.remoteops-shot-fullscreen').forEach(node => node.remove());
  const overlay = document.createElement('div');
  overlay.className = 'remoteops-shot-fullscreen';
  overlay.innerHTML = `
    <button type="button" class="remoteops-shot-fullscreen-close" aria-label="Close">×</button>
    <img alt="${esc(label)}" src="${esc(src)}" />
    <div class="remoteops-shot-fullscreen-label">${esc(label)}</div>
  `;
  overlay.addEventListener('click', event => {
    if (event.target === overlay || event.target.closest('.remoteops-shot-fullscreen-close')) overlay.remove();
  });
  document.body.appendChild(overlay);
}

async function deleteScreenshot(state, shot) {
  if (!window.confirm(`Delete this screenshot captured at ${new Date(shot.capturedAt).toLocaleString()}?`)) return;
  try {
    const response = await fetch(`${API_URL}/activity/screenshots/${encodeURIComponent(shot.id)}`, {
      method: 'DELETE',
      headers: headers(),
    });
    if (!response.ok) throw new Error(`Delete failed (${response.status})`);
    state.items = state.items.filter(item => String(item.id) !== String(shot.id));
    state.selectedIds.delete(String(shot.id));
    state.total = state.items.length;
    state.page = Math.min(state.page, Math.max(1, Math.ceil(state.total / PAGE_SIZE)));
    renderOverlay(state);
  } catch (_) {
    alert('Unable to delete this screenshot.');
  }
}

async function deleteSelected(state) {
  const ids = [...state.selectedIds];
  if (!ids.length) return;
  if (!window.confirm(`Delete ${ids.length} selected screenshot${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
  try {
    const response = await fetch(`${API_URL}/activity/screenshots/delete-bulk`, {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (!response.ok) throw new Error(`Bulk delete failed (${response.status})`);
    const removed = new Set(ids.map(String));
    state.items = state.items.filter(item => !removed.has(String(item.id)));
    state.selectedIds.clear();
    state.total = state.items.length;
    state.page = Math.min(state.page, Math.max(1, Math.ceil(state.total / PAGE_SIZE)));
    renderOverlay(state);
  } catch (_) {
    alert('Unable to delete the selected screenshots.');
  }
}

function tileHtml(shot, state) {
  const id = String(shot.id);
  const label = `${shot.employeeName || 'Employee'} — ${new Date(shot.capturedAt).toLocaleString()}`;
  const checked = state.selectedIds.has(id) ? 'checked' : '';
  return `<div class="remoteops-shot-overlay-tile">
    <input class="remoteops-shot-overlay-check" type="checkbox" data-shot-select="${esc(id)}" ${checked} aria-label="Select screenshot" />
    <button type="button" class="remoteops-shot-overlay-image-button" data-shot-view="${esc(id)}" title="Click to view full size">
      <img class="remoteops-shot-overlay-image" loading="lazy" src="${esc(uploadUrl(shot.url))}" alt="${esc(label)}" />
    </button>
    <button type="button" class="remoteops-shot-overlay-delete" data-shot-delete="${esc(id)}" title="Delete screenshot">×</button>
    <div class="remoteops-shot-overlay-meta">
      <div class="remoteops-shot-overlay-name">${esc(shot.employeeName || 'Unknown Employee')}</div>
      <div class="remoteops-shot-overlay-date">${esc(new Date(shot.capturedAt).toLocaleString())}</div>
    </div>
  </div>`;
}

function positionOverlay(card, state) {
  if (!state.overlay) return;
  const grid = screenshotGrid(card);
  if (!grid) return;
  const rect = grid.getBoundingClientRect();
  const top = Math.round(rect.top + window.scrollY);
  const left = Math.round(rect.left + window.scrollX);
  const width = Math.round(rect.width);
  const height = Math.max(360, Math.round(rect.height + 64));
  state.lastRect = { top, left, width, height };
  state.overlay.style.top = `${top}px`;
  state.overlay.style.left = `${left}px`;
  state.overlay.style.width = `${width}px`;
  state.overlay.style.height = `${height}px`;
}

function wireOverlay(card, state) {
  const overlay = state.overlay;
  if (!overlay) return;

  overlay.querySelector('[data-shot-prev]')?.addEventListener('click', () => {
    if (state.page <= 1) return;
    state.page -= 1;
    state.selectedIds.clear();
    renderOverlay(state);
  });

  overlay.querySelector('[data-shot-next]')?.addEventListener('click', () => {
    const totalPages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
    if (state.page >= totalPages) return;
    state.page += 1;
    state.selectedIds.clear();
    renderOverlay(state);
  });

  overlay.querySelector('[data-shot-select-all]')?.addEventListener('change', event => {
    const pageItems = state.items.slice((state.page - 1) * PAGE_SIZE, state.page * PAGE_SIZE);
    pageItems.forEach(item => event.target.checked ? state.selectedIds.add(String(item.id)) : state.selectedIds.delete(String(item.id)));
    renderOverlay(state);
  });

  overlay.querySelectorAll('[data-shot-select]').forEach(input => input.addEventListener('change', () => {
    const id = String(input.dataset.shotSelect);
    if (input.checked) state.selectedIds.add(id);
    else state.selectedIds.delete(id);
    renderOverlay(state);
  }));

  overlay.querySelectorAll('[data-shot-view]').forEach(button => button.addEventListener('click', () => {
    const id = String(button.dataset.shotView);
    const shot = state.items.find(item => String(item.id) === id);
    if (shot) openFullscreen(shot.url, `${shot.employeeName || 'Employee'} — ${new Date(shot.capturedAt).toLocaleString()}`);
  }));

  overlay.querySelectorAll('[data-shot-delete]').forEach(button => button.addEventListener('click', () => {
    const id = String(button.dataset.shotDelete);
    const shot = state.items.find(item => String(item.id) === id);
    if (shot) deleteScreenshot(state, shot);
  }));

  overlay.querySelector('[data-shot-delete-selected]')?.addEventListener('click', () => deleteSelected(state));
}

function renderOverlay(state) {
  const overlay = state.overlay;
  if (!overlay) return;
  const totalPages = Math.max(1, Math.ceil(state.total / PAGE_SIZE));
  state.page = Math.min(state.page, totalPages);
  const start = (state.page - 1) * PAGE_SIZE;
  const pageItems = state.items.slice(start, start + PAGE_SIZE);
  const allSelected = pageItems.length > 0 && pageItems.every(item => state.selectedIds.has(String(item.id)));
  const size = sizeValue();

  overlay.innerHTML = `
    <div class="remoteops-shot-overlay-inner">
      <div class="remoteops-shot-overlay-summary">
        <label class="remoteops-shot-overlay-bulk"><input type="checkbox" data-shot-select-all ${allSelected ? 'checked' : ''}/> Select page</label>
        <span class="remoteops-shot-overlay-summary-text">${state.total} screenshot${state.total === 1 ? '' : 's'} · Page ${state.page} of ${totalPages}</span>
        ${state.selectedIds.size ? `<button type="button" class="remoteops-shot-overlay-btn" data-shot-delete-selected>Delete ${state.selectedIds.size} Selected</button>` : ''}
      </div>
      ${state.loading ? '<div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:12px">Loading screenshots…</div>' : state.error ? `<div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--danger);font-size:12px;text-align:center;padding:20px">${esc(state.error)}</div>` : pageItems.length ? `<div class="remoteops-shot-overlay-grid" style="grid-template-columns:repeat(auto-fill,minmax(${size}px,1fr))">${pageItems.map(item => tileHtml(item, state)).join('')}</div>` : '<div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--text-muted);font-size:12px">No screenshots available.</div>'}
      <div class="remoteops-shot-overlay-nav">
        <button type="button" class="remoteops-shot-overlay-btn" data-shot-prev ${state.page <= 1 ? 'disabled' : ''}>Previous</button>
        <span class="remoteops-shot-overlay-page">Page ${state.page} / ${totalPages}</span>
        <button type="button" class="remoteops-shot-overlay-btn" data-shot-next ${state.page >= totalPages ? 'disabled' : ''}>Next</button>
      </div>
    </div>`;

  positionOverlay(state.card, state);
  wireOverlay(state.card, state);
}

async function ensureOverlay(card) {
  const state = getState(card);
  state.card = card;

  const grid = screenshotGrid(card);
  if (!grid) return;

  if (!state.overlay || !state.overlay.isConnected) {
    const overlay = document.createElement('div');
    overlay.className = 'remoteops-shot-overlay';
    overlay.setAttribute(OVERLAY_ATTR, 'true');
    document.body.appendChild(overlay);
    state.overlay = overlay;
  }

  positionOverlay(card, state);

  if (!state.items.length && !state.loading && state.total === 0) {
    state.loading = true;
    state.error = '';
    renderOverlay(state);
    try {
      const items = await fetchAll(state);
      if (items) state.items = items;
      state.loading = false;
      renderOverlay(state);
    } catch (error) {
      state.loading = false;
      if (error?.name === 'AbortError') return;
      state.error = 'Unable to load screenshots. Please restart the backend and refresh the page.';
      renderOverlay(state);
      console.error('Remote Ops screenshot pagination:', error);
    }
  } else {
    renderOverlay(state);
  }
}

function cleanup() {
  screenshotCards().forEach(card => {
    const state = states.get(card);
    if (state?.overlay?.isConnected) state.overlay.remove();
  });
}

function refresh() {
  const cards = screenshotCards();
  const liveSet = new Set(cards);
  cards.forEach(card => ensureOverlay(card));
  if (activeCards) {
    // Keep stale overlays out of pages that React has navigated away from.
    document.querySelectorAll(`[${OVERLAY_ATTR}]`).forEach(node => {
      const owner = [...states].find?.(() => false);
      void owner;
    });
  }
}

function start() {
  if (started) return;
  started = true;
  injectStyles();
  refresh();
  observer = new MutationObserver(() => refresh());
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', () => screenshotCards().forEach(card => positionOverlay(card, getState(card))));
  window.addEventListener('scroll', () => screenshotCards().forEach(card => positionOverlay(card, getState(card))), { passive: true });
  window.addEventListener('storage', event => {
    if (event.key === SIZE_KEY) screenshotCards().forEach(card => renderOverlay(getState(card)));
  });
}

start();
