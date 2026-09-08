/* Main Screenshots pagination.
   Important: React owns the page/card/grid DOM. This enhancer never removes,
   inserts, or rearranges React-managed children. It only reads the existing
   screenshot card and renders an independent viewer attached to document.body.
*/

const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.1.2:4000/api';
const PAGE_SIZE = 60;
const BATCH_SIZE = 200;
const SIZE_KEY = 'remoteops_screenshot_tile_size';
const STYLE_ID = 'remoteops-safe-screenshot-pagination-style';
const OVERLAY_ATTR = 'data-remoteops-safe-screenshot-overlay';

let started = false;
let currentCard = null;
let overlay = null;
let state = null;

const textOf = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const headers = () => {
  const token = localStorage.getItem('rw_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};

function uploadUrl(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_URL.replace(/\/api\/?$/, '')}${url}`;
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function tileSize() {
  const n = Number(localStorage.getItem(SIZE_KEY));
  return Number.isFinite(n) ? Math.min(520, Math.max(160, Math.round(n / 10) * 10)) : 220;
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .remoteops-safe-shot-overlay{position:absolute;z-index:30;background:var(--surface);border:1px solid var(--border);border-radius:10px;box-shadow:0 14px 38px rgba(0,0,0,.24);overflow:hidden}
    .remoteops-safe-shot-inner{height:100%;display:flex;flex-direction:column;padding:8px;box-sizing:border-box}
    .remoteops-safe-shot-summary{display:flex;align-items:center;gap:10px;min-height:30px;padding:0 2px 8px}
    .remoteops-safe-shot-summary-text{flex:1;font-size:10px;font-weight:800;color:var(--text-muted)}
    .remoteops-safe-shot-select{display:flex;align-items:center;gap:6px;font-size:10px;font-weight:800;color:var(--text-muted);white-space:nowrap}
    .remoteops-safe-shot-grid{flex:1;display:grid;grid-template-columns:repeat(auto-fill,minmax(var(--remoteops-shot-size),1fr));gap:12px;align-content:start;overflow:hidden}
    .remoteops-safe-shot-tile{position:relative;min-width:0;border:1px solid var(--border);border-radius:9px;overflow:hidden;background:var(--bg)}
    .remoteops-safe-shot-image-btn{display:block;width:100%;padding:0;border:0;background:var(--bg);cursor:zoom-in}
    .remoteops-safe-shot-image{display:block;width:100%;aspect-ratio:16/10;object-fit:cover}
    .remoteops-safe-shot-meta{padding:6px 8px;background:var(--surface)}
    .remoteops-safe-shot-name{font-size:9px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .remoteops-safe-shot-date{margin-top:2px;font-size:8px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .remoteops-safe-shot-check{position:absolute;top:6px;left:6px;z-index:2;width:15px;height:15px}
    .remoteops-safe-shot-delete{position:absolute;top:5px;right:5px;z-index:2;width:27px;height:27px;border:0;border-radius:7px;background:rgba(0,0,0,.68);color:#fff;font-weight:900;cursor:pointer}
    .remoteops-safe-shot-delete:hover{background:var(--danger)}
    .remoteops-safe-shot-nav{display:flex;align-items:center;justify-content:center;gap:7px;padding:9px 2px 2px}
    .remoteops-safe-shot-btn{height:30px;min-width:34px;padding:0 10px;border:1px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text);font-size:10px;font-weight:800;cursor:pointer}
    .remoteops-safe-shot-btn:disabled{opacity:.45;cursor:not-allowed}
    .remoteops-safe-shot-fullscreen{position:fixed;inset:0;z-index:10001;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.92)}
    .remoteops-safe-shot-fullscreen img{max-width:96vw;max-height:92vh;width:auto;height:auto;object-fit:contain;border-radius:8px}
    .remoteops-safe-shot-close{position:absolute;top:16px;right:18px;width:40px;height:40px;border:1px solid rgba(255,255,255,.2);border-radius:999px;background:rgba(0,0,0,.55);color:#fff;font-size:22px;cursor:pointer}
    .remoteops-safe-shot-label{position:absolute;left:18px;bottom:16px;max-width:78vw;padding:7px 10px;border-radius:7px;background:rgba(0,0,0,.6);border:1px solid rgba(255,255,255,.15);color:#fff;font-size:10px;font-weight:700}
  `;
  document.head.appendChild(style);
}

function findCard() {
  return [...document.querySelectorAll('.card')].find(card =>
    [...card.querySelectorAll('h3')].some(h => /^Screenshots$|^Team Screenshots$/i.test(textOf(h)))
  ) || null;
}

function findGrid(card) {
  return [...card.querySelectorAll('.grid')].find(grid => grid.querySelector('img')) || null;
}

function reset() {
  if (overlay?.isConnected) overlay.remove();
  overlay = null;
  currentCard = null;
  state = null;
}

async function fetchAllScreenshots(localState) {
  const all = [];
  let offset = 0;
  while (true) {
    const params = new URLSearchParams({ offset: String(offset), limit: String(BATCH_SIZE) });
    const response = await fetch(`${API_URL}/activity/screenshots-feed?${params}`, { headers: headers() });
    if (!response.ok) throw new Error(`Screenshot feed request failed (${response.status})`);
    const payload = await response.json();
    const batch = Array.isArray(payload?.items) ? payload.items : [];
    all.push(...batch);
    if (!payload?.hasMore || batch.length === 0) break;
    offset += batch.length;
    if (localState !== state) return [];
  }
  return all;
}

function openFullscreen(url, label) {
  const src = uploadUrl(url);
  if (!src) return;
  document.querySelectorAll('.remoteops-safe-shot-fullscreen').forEach(node => node.remove());
  const viewer = document.createElement('div');
  viewer.className = 'remoteops-safe-shot-fullscreen';
  viewer.innerHTML = `<button type="button" class="remoteops-safe-shot-close" aria-label="Close">×</button><img src="${esc(src)}" alt="${esc(label)}"><div class="remoteops-safe-shot-label">${esc(label)}</div>`;
  viewer.addEventListener('click', event => {
    if (event.target === viewer || event.target.closest('.remoteops-safe-shot-close')) viewer.remove();
  });
  document.body.appendChild(viewer);
}

async function deleteOne(shot) {
  if (!window.confirm(`Delete this screenshot captured at ${new Date(shot.capturedAt).toLocaleString()}?`)) return;
  try {
    const response = await fetch(`${API_URL}/activity/screenshots/${encodeURIComponent(shot.id)}`, {
      method: 'DELETE',
      headers: headers(),
    });
    if (!response.ok) throw new Error(`Delete failed (${response.status})`);
    state.items = state.items.filter(item => String(item.id) !== String(shot.id));
    state.selected.delete(String(shot.id));
    render();
  } catch (_) {
    alert('Unable to delete this screenshot.');
  }
}

async function deleteSelected() {
  const ids = [...state.selected];
  if (!ids.length) return;
  if (!window.confirm(`Delete ${ids.length} selected screenshots? This cannot be undone.`)) return;
  try {
    const response = await fetch(`${API_URL}/activity/screenshots/delete-bulk`, {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids }),
    });
    if (!response.ok) throw new Error(`Bulk delete failed (${response.status})`);
    const removed = new Set(ids);
    state.items = state.items.filter(item => !removed.has(String(item.id)));
    state.selected.clear();
    render();
  } catch (_) {
    alert('Unable to delete the selected screenshots.');
  }
}

function tileHtml(shot) {
  const id = String(shot.id);
  const label = `${shot.employeeName || 'Employee'} — ${new Date(shot.capturedAt).toLocaleString()}`;
  const checked = state.selected.has(id) ? 'checked' : '';
  return `<div class="remoteops-safe-shot-tile"><input class="remoteops-safe-shot-check" type="checkbox" data-shot-select="${esc(id)}" ${checked} aria-label="Select screenshot"><button type="button" class="remoteops-safe-shot-image-btn" data-shot-view="${esc(id)}" title="Click to view full size"><img class="remoteops-safe-shot-image" loading="lazy" src="${esc(uploadUrl(shot.url))}" alt="${esc(label)}"></button><button type="button" class="remoteops-safe-shot-delete" data-shot-delete="${esc(id)}" title="Delete screenshot">×</button><div class="remoteops-safe-shot-meta"><div class="remoteops-safe-shot-name">${esc(shot.employeeName || 'Unknown Employee')}</div><div class="remoteops-safe-shot-date">${esc(new Date(shot.capturedAt).toLocaleString())}</div></div></div>`;
}

function position() {
  if (!overlay || !currentCard) return;
  const grid = findGrid(currentCard);
  if (!grid) return;
  const rect = grid.getBoundingClientRect();
  overlay.style.top = `${Math.round(rect.top + window.scrollY)}px`;
  overlay.style.left = `${Math.round(rect.left + window.scrollX)}px`;
  overlay.style.width = `${Math.round(rect.width)}px`;
  overlay.style.height = `${Math.max(360, Math.round(rect.height + 64))}px`;
}

function wire() {
  if (!overlay) return;

  overlay.querySelector('[data-shot-prev]')?.addEventListener('click', () => {
    if (state.page <= 1) return;
    state.page -= 1;
    state.selected.clear();
    render();
  });

  overlay.querySelector('[data-shot-next]')?.addEventListener('click', () => {
    const totalPages = Math.max(1, Math.ceil(state.items.length / PAGE_SIZE));
    if (state.page >= totalPages) return;
    state.page += 1;
    state.selected.clear();
    render();
  });

  overlay.querySelector('[data-shot-select-all]')?.addEventListener('change', event => {
    const start = (state.page - 1) * PAGE_SIZE;
    const pageItems = state.items.slice(start, start + PAGE_SIZE);
    pageItems.forEach(item => event.target.checked ? state.selected.add(String(item.id)) : state.selected.delete(String(item.id)));
    render();
  });

  overlay.querySelectorAll('[data-shot-select]').forEach(input => input.addEventListener('change', () => {
    const id = String(input.dataset.shotSelect);
    input.checked ? state.selected.add(id) : state.selected.delete(id);
    render();
  }));

  overlay.querySelectorAll('[data-shot-view]').forEach(button => button.addEventListener('click', () => {
    const shot = state.items.find(item => String(item.id) === String(button.dataset.shotView));
    if (shot) openFullscreen(shot.url, `${shot.employeeName || 'Employee'} — ${new Date(shot.capturedAt).toLocaleString()}`);
  }));

  overlay.querySelectorAll('[data-shot-delete]').forEach(button => button.addEventListener('click', () => {
    const shot = state.items.find(item => String(item.id) === String(button.dataset.shotDelete));
    if (shot) deleteOne(shot);
  }));

  overlay.querySelector('[data-shot-delete-selected]')?.addEventListener('click', deleteSelected);
}

function render() {
  if (!overlay || !state) return;
  const totalPages = Math.max(1, Math.ceil(state.items.length / PAGE_SIZE));
  state.page = Math.min(state.page, totalPages);
  const start = (state.page - 1) * PAGE_SIZE;
  const pageItems = state.items.slice(start, start + PAGE_SIZE);
  const allSelected = pageItems.length > 0 && pageItems.every(item => state.selected.has(String(item.id)));

  overlay.innerHTML = `<div class="remoteops-safe-shot-inner"><div class="remoteops-safe-shot-summary"><label class="remoteops-safe-shot-select"><input type="checkbox" data-shot-select-all ${allSelected ? 'checked' : ''}> Select page</label><span class="remoteops-safe-shot-summary-text">${state.items.length} screenshot${state.items.length === 1 ? '' : 's'} · Page ${state.page} of ${totalPages}</span>${state.selected.size ? '<button type="button" class="remoteops-safe-shot-btn" data-shot-delete-selected>Delete ' + state.selected.size + ' Selected</button>' : ''}</div><div class="remoteops-safe-shot-grid" style="--remoteops-shot-size:${tileSize()}px">${pageItems.map(tileHtml).join('')}</div><div class="remoteops-safe-shot-nav"><button type="button" class="remoteops-safe-shot-btn" data-shot-prev ${state.page <= 1 ? 'disabled' : ''}>Previous</button><span class="remoteops-safe-shot-summary-text">Page ${state.page} / ${totalPages}</span><button type="button" class="remoteops-safe-shot-btn" data-shot-next ${state.page >= totalPages ? 'disabled' : ''}>Next</button></div></div>`;
  position();
  wire();
}

async function mount(card) {
  if (!card) {
    reset();
    return;
  }

  const grid = findGrid(card);
  if (!grid) return;

  if (currentCard !== card) {
    reset();
    currentCard = card;
    state = { page: 1, items: [], selected: new Set(), loading: true, error: '' };
    overlay = document.createElement('div');
    overlay.className = 'remoteops-safe-shot-overlay';
    overlay.setAttribute(OVERLAY_ATTR, 'true');
    document.body.appendChild(overlay);
    position();
    render();

    try {
      const localState = state;
      const items = await fetchAllScreenshots(localState);
      if (localState !== state) return;
      state.items = items;
      state.loading = false;
      render();
    } catch (error) {
      if (localState !== state) return;
      state.loading = false;
      state.error = error?.message || 'Unable to load screenshots.';
      overlay.innerHTML = `<div class="remoteops-safe-shot-inner"><div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--danger);font-size:12px;text-align:center;padding:20px">${esc(state.error)}</div></div>`;
      position();
      console.error('Remote Ops screenshot pagination:', error);
    }
  } else {
    position();
  }
}

function tick() {
  const card = findCard();
  void mount(card);
}

function start() {
  if (started) return;
  started = true;
  injectStyles();
  tick();
  setInterval(tick, 750);
  window.addEventListener('resize', () => position());
  window.addEventListener('scroll', () => position(), { passive: true });
  window.addEventListener('keydown', event => {
    if (event.key === 'Escape') document.querySelectorAll('.remoteops-safe-shot-fullscreen').forEach(node => node.remove());
  });
  window.addEventListener('storage', event => {
    if (event.key === SIZE_KEY && state) render();
  });
}

start();
