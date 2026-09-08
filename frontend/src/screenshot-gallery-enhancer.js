/* Authoritative screenshot gallery layer.
   Hides the legacy 60-image React grid and renders one paginated gallery.
   The dashboard uses the same screenshot metadata/full-screen behavior.
   DOM observation only re-ensures the gallery; network refreshes are timer-driven. */

const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.1.2:4000/api';
const PAGE_SIZE = 36;
const FETCH_LIMIT = 200;
const STYLE_ID = 'remoteops-screenshot-gallery-style';
const ROOT_ATTR = 'data-remoteops-screenshot-gallery';
const OVERLAY_ID = 'remoteops-screenshot-fullscreen';
const REFRESH_MS = 8000;

const pageState = new WeakMap();
let requestInFlight = false;
let refreshTimer = null;

function headers() {
  const token = localStorage.getItem('rw_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function textOf(el) { return (el?.textContent || '').replace(/\s+/g, ' ').trim(); }
function formatDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    [${ROOT_ATTR}="true"]{margin-top:0}
    .remoteops-gallery-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    @media (min-width:768px){.remoteops-gallery-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
    .remoteops-gallery-tile{overflow:hidden;border:1px solid var(--border);border-radius:10px;background:var(--surface);min-width:0}
    .remoteops-gallery-image-wrap{appearance:none;border:0;padding:0;margin:0;display:block;width:100%;aspect-ratio:16/9;background:var(--bg);overflow:hidden;cursor:zoom-in}
    .remoteops-gallery-image{width:100%;height:100%;object-fit:cover;display:block}
    .remoteops-gallery-meta{padding:8px 9px 9px;font-size:10px;line-height:1.35}
    .remoteops-gallery-user{font-weight:800;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .remoteops-gallery-sub{color:var(--text-muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .remoteops-gallery-pagination{display:flex;align-items:center;justify-content:center;gap:6px;flex-wrap:wrap;margin-top:14px}
    .remoteops-gallery-pagination button{border:1px solid var(--border);border-radius:8px;padding:5px 9px;font-size:10px;font-weight:800;background:var(--surface);color:var(--text);cursor:pointer}
    .remoteops-gallery-pagination button:disabled{opacity:.45;cursor:default}
    .remoteops-gallery-pagination button.active{background:var(--accent);color:#fff;border-color:var(--accent)}
    .remoteops-gallery-count{text-align:center;color:var(--text-muted);font-size:10px;margin-top:7px}
    #${OVERLAY_ID}{position:fixed;inset:0;z-index:120;background:rgba(0,0,0,.82);display:flex;align-items:center;justify-content:center;padding:18px}
    #${OVERLAY_ID} .remoteops-fullscreen-shell{width:min(1400px,96vw);height:min(92vh,1000px);display:flex;flex-direction:column;background:var(--surface);border:1px solid var(--border);border-radius:14px;overflow:hidden;box-shadow:0 24px 80px rgba(0,0,0,.45)}
    #${OVERLAY_ID} .remoteops-fullscreen-bar{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 13px;border-bottom:1px solid var(--border);font-size:11px}
    #${OVERLAY_ID} .remoteops-fullscreen-title{font-weight:800;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    #${OVERLAY_ID} .remoteops-fullscreen-close{border:1px solid var(--border);border-radius:8px;padding:5px 8px;background:var(--surface);color:var(--text);font-weight:800;cursor:pointer}
    #${OVERLAY_ID} .remoteops-fullscreen-body{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;background:var(--bg);overflow:auto;padding:12px}
    #${OVERLAY_ID} img{max-width:100%;max-height:100%;object-fit:contain;cursor:zoom-out}
    .remoteops-dashboard-screenshot-card{position:relative}
    .remoteops-dashboard-screenshot-card input[type="range"]{position:relative;z-index:20;pointer-events:auto}
  `;
  document.head.appendChild(style);
}

function findCards() {
  return [...document.querySelectorAll('main .card')].filter(card => {
    const t = textOf(card);
    const heading = card.querySelector('h1,h2,h3,h4');
    return card.querySelector('img') && (/^Screenshots$/i.test(textOf(heading)) || /Recent Screenshots/i.test(t));
  });
}
function fullPageCard() {
  return findCards().find(card => /^Screenshots$/i.test(textOf(card.querySelector('h1,h2,h3,h4')))) || null;
}
function dashboardCard() {
  return findCards().find(card => /Recent Screenshots/i.test(textOf(card)) && card !== fullPageCard()) || null;
}

function getFilters(card) {
  const select = card?.querySelector('select');
  const date = card?.querySelector('input[type="date"]');
  return { employeeId: select?.value || '', date: date?.value || '' };
}

function hideLegacyGrid(card) {
  if (!card) return null;
  let root = card.querySelector(`[${ROOT_ATTR}="true"]`);
  if (root) return root;

  const legacyGrid = [...card.querySelectorAll('div')].find(node => {
    const images = node.querySelectorAll('img').length;
    return images >= 2 && images <= 60 && !node.querySelector(`[${ROOT_ATTR}="true"]`);
  });
  if (legacyGrid) legacyGrid.style.display = 'none';

  root = document.createElement('div');
  root.dataset.remoteopsScreenshotGallery = 'true';
  (legacyGrid?.parentElement || card).appendChild(root);
  pageState.set(root, { page: 1, items: [], filterKey: '' });
  return root;
}

function openFullscreen(item) {
  document.getElementById(OVERLAY_ID)?.remove();
  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.innerHTML = `
    <div class="remoteops-fullscreen-shell" role="dialog" aria-modal="true" aria-label="Screenshot preview">
      <div class="remoteops-fullscreen-bar"><div class="remoteops-fullscreen-title"></div><button type="button" class="remoteops-fullscreen-close">Close</button></div>
      <div class="remoteops-fullscreen-body"><img alt="Screenshot preview" /></div>
    </div>`;
  overlay.querySelector('.remoteops-fullscreen-title').textContent = `${item.currentUser || item.employeeName || 'Unknown User'} · ${item.display || item.displayName || 'Display'} · ${formatDate(item.capturedAt)}`;
  overlay.querySelector('img').src = item.url;
  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('.remoteops-fullscreen-close').addEventListener('click', close);
  overlay.querySelector('img').addEventListener('click', close);
  const onKey = e => { if (e.key === 'Escape') { close(); document.removeEventListener('keydown', onKey); } };
  document.addEventListener('keydown', onKey);
  document.body.appendChild(overlay);
}

function renderGallery(root, items) {
  const local = pageState.get(root) || { page: 1, items: [], filterKey: '' };
  local.items = items;
  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  local.page = Math.max(1, Math.min(local.page, totalPages));
  pageState.set(root, local);
  const start = (local.page - 1) * PAGE_SIZE;
  const pageItems = items.slice(start, start + PAGE_SIZE);
  root.innerHTML = '';
  if (!pageItems.length) {
    root.innerHTML = '<div class="py-10 text-center text-sm text-muted">No screenshots match this filter.</div>';
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'remoteops-gallery-grid';
  pageItems.forEach(item => {
    const tile = document.createElement('div');
    tile.className = 'remoteops-gallery-tile';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'remoteops-gallery-image-wrap';
    button.title = 'Click to view full screen';
    const img = document.createElement('img');
    img.className = 'remoteops-gallery-image';
    img.loading = 'lazy';
    img.src = item.url;
    img.alt = `${item.currentUser || item.employeeName || 'Unknown User'} screenshot`;
    button.appendChild(img);
    button.addEventListener('click', () => openFullscreen(item));
    const meta = document.createElement('div');
    meta.className = 'remoteops-gallery-meta';
    const user = document.createElement('div');
    user.className = 'remoteops-gallery-user';
    user.textContent = item.currentUser || item.employeeName || 'Unknown User';
    const sub = document.createElement('div');
    sub.className = 'remoteops-gallery-sub';
    sub.textContent = `${item.display || item.displayName || 'Display'} · ${formatDate(item.capturedAt)}`;
    meta.append(user, sub);
    tile.append(button, meta);
    grid.appendChild(tile);
  });
  root.appendChild(grid);

  const nav = document.createElement('div');
  nav.className = 'remoteops-gallery-pagination';
  const prev = document.createElement('button');
  prev.type = 'button'; prev.textContent = 'Previous'; prev.disabled = local.page === 1;
  prev.addEventListener('click', () => { local.page -= 1; renderGallery(root, local.items); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  nav.appendChild(prev);
  const first = Math.max(1, Math.min(local.page - 2, totalPages - 4));
  const last = Math.min(totalPages, first + 4);
  for (let p = first; p <= last; p += 1) {
    const b = document.createElement('button');
    b.type = 'button'; b.textContent = String(p); b.className = p === local.page ? 'active' : '';
    b.addEventListener('click', () => { local.page = p; renderGallery(root, local.items); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    nav.appendChild(b);
  }
  const next = document.createElement('button');
  next.type = 'button'; next.textContent = 'Next'; next.disabled = local.page === totalPages;
  next.addEventListener('click', () => { local.page += 1; renderGallery(root, local.items); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  nav.appendChild(next);
  root.appendChild(nav);
  const count = document.createElement('div');
  count.className = 'remoteops-gallery-count';
  count.textContent = `Showing ${start + 1}–${Math.min(start + PAGE_SIZE, items.length)} of ${items.length} screenshots · Page ${local.page} of ${totalPages}`;
  root.appendChild(count);
}

function renderDashboard(root, items) {
  root.innerHTML = '';
  const latest = items.slice(0, 8);
  const grid = document.createElement('div');
  grid.className = 'remoteops-gallery-grid';
  latest.forEach(item => {
    const tile = document.createElement('div');
    tile.className = 'remoteops-gallery-tile';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'remoteops-gallery-image-wrap';
    button.title = 'Click to view full screen';
    const img = document.createElement('img');
    img.className = 'remoteops-gallery-image';
    img.loading = 'lazy';
    img.src = item.url;
    img.alt = `${item.currentUser || item.employeeName || 'Unknown User'} screenshot`;
    button.appendChild(img);
    button.addEventListener('click', e => { e.stopPropagation(); openFullscreen(item); });
    const meta = document.createElement('div');
    meta.className = 'remoteops-gallery-meta';
    const user = document.createElement('div');
    user.className = 'remoteops-gallery-user';
    user.textContent = item.currentUser || item.employeeName || 'Unknown User';
    const sub = document.createElement('div');
    sub.className = 'remoteops-gallery-sub';
    sub.textContent = `${item.display || item.displayName || 'Display'} · ${formatDate(item.capturedAt)}`;
    meta.append(user, sub);
    tile.append(button, meta);
    grid.appendChild(tile);
  });
  root.appendChild(grid);
}

async function refreshCard(card, root, dashboard) {
  const filters = getFilters(card);
  const local = pageState.get(root) || { page: 1, items: [], filterKey: '' };
  const key = `${filters.employeeId}|${filters.date}|${dashboard ? 'dashboard' : 'full'}`;
  if (local.filterKey !== key) { local.page = 1; local.filterKey = key; }
  pageState.set(root, local);

  const params = new URLSearchParams({ limit: String(FETCH_LIMIT) });
  if (/^\d+$/.test(String(filters.employeeId))) params.set('employeeId', filters.employeeId);
  if (filters.date) params.set('date', filters.date);
  const response = await fetch(`${API_URL}/activity/screenshots?${params.toString()}`, { headers: headers() });
  if (!response.ok) return;
  const data = await response.json();
  const items = Array.isArray(data) ? data : [];
  if (dashboard) renderDashboard(root, items);
  else renderGallery(root, items);
}

async function refreshAll() {
  if (requestInFlight) return;
  requestInFlight = true;
  try {
    const full = fullPageCard();
    if (full) await refreshCard(full, hideLegacyGrid(full), false);
    const dash = dashboardCard();
    if (dash) await refreshCard(dash, hideLegacyGrid(dash), true);
  } catch (_) {
    // Preserve existing content during transient network failures.
  } finally {
    requestInFlight = false;
  }
}

function bindDashboardControls(card) {
  if (!card || card.dataset.remoteopsControlsBound === 'true') return;
  card.dataset.remoteopsControlsBound = 'true';
  card.classList.add('remoteops-dashboard-screenshot-card');
  const stop = e => e.stopPropagation();
  card.querySelectorAll('input[type="range"]').forEach(input => {
    ['click','pointerdown','mousedown','mouseup','change'].forEach(type => input.addEventListener(type, stop));
  });
}

function ensure() {
  injectStyles();
  const full = fullPageCard();
  if (full) hideLegacyGrid(full);
  const dash = dashboardCard();
  if (dash) { hideLegacyGrid(dash); bindDashboardControls(dash); }
}

function start() {
  ensure();
  refreshAll();
  clearInterval(refreshTimer);
  refreshTimer = setInterval(refreshAll, REFRESH_MS);
  const observer = new MutationObserver(() => ensure());
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener('change', e => {
    const target = e.target;
    if (target?.matches?.('main .card select, main .card input[type="date"]')) refreshAll();
  }, true);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();

export {};
