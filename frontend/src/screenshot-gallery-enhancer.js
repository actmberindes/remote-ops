/* Replaces the legacy ScreenshotsSection gallery UI without changing the
   underlying React component. This keeps the old 60-image grid hidden,
   renders one authoritative paginated gallery, preserves full-screen viewing,
   and keeps dashboard screenshot controls isolated from View All navigation. */

const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.1.2:4000/api';
const PAGE_SIZE = 36;
const MAX_ITEMS = 200;
const STYLE_ID = 'remoteops-screenshot-gallery-style';
const ROOT_ATTR = 'data-remoteops-screenshot-gallery';
const OVERLAY_ID = 'remoteops-screenshot-fullscreen';

let timer = null;
let requestInFlight = false;
let cache = [];
let state = { page: 1, employeeId: '', date: '' };

function headers() {
  const token = localStorage.getItem('rw_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function textOf(el) {
  return (el?.textContent || '').replace(/\s+/g, ' ').trim();
}

function normalizeUrl(url) {
  try { return decodeURIComponent(new URL(url, window.location.origin).pathname); }
  catch (_) { return String(url || ''); }
}

function formatDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit'
  });
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
    .remoteops-gallery-image-wrap{aspect-ratio:16/9;background:var(--bg);display:flex;align-items:center;justify-content:center;overflow:hidden;cursor:zoom-in}
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
    .remoteops-dashboard-screenshot-card button[data-view-all-control]{position:relative;z-index:3}
    .remoteops-dashboard-screenshot-card input[type="range"]{position:relative;z-index:4}
  `;
  document.head.appendChild(style);
}

function isScreenshotsPage(card) {
  const heading = [...card.querySelectorAll('h1,h2,h3,h4')].find(el => /screenshots/i.test(textOf(el)));
  return Boolean(heading && /^Screenshots$/i.test(textOf(heading)));
}

function findScreenshotCards() {
  return [...document.querySelectorAll('main .card')].filter(card => {
    const text = textOf(card);
    return /Screenshots|Recent Screenshots|Scheduled desktop captures|Latest scheduled captures|Latest captures from your team/i.test(text)
      && card.querySelector('img');
  });
}

function findFullPageCard() {
  return findScreenshotCards().find(isScreenshotsPage) || null;
}

function findDashboardCard() {
  return findScreenshotCards().find(card => /Recent Screenshots/i.test(textOf(card)) && !isScreenshotsPage(card)) || null;
}

function getFilters(card) {
  const select = card?.querySelector('select');
  const dateInput = card?.querySelector('input[type="date"]');
  return {
    employeeId: select?.value || '',
    date: dateInput?.value || ''
  };
}

function hideLegacyGallery(card) {
  if (!card) return null;
  const root = card.querySelector(`[${ROOT_ATTR}="true"]`);
  if (root) return root;

  const candidates = [...card.querySelectorAll('div')].filter(node => node.children?.length);
  const legacyGrid = candidates.find(node => {
    const imgs = node.querySelectorAll('img').length;
    return imgs >= 2 && imgs <= 60 && !node.querySelector(`[${ROOT_ATTR}="true"]`);
  });
  if (legacyGrid) legacyGrid.style.display = 'none';

  const rootNode = document.createElement('div');
  rootNode.dataset.remoteopsScreenshotGallery = 'true';
  if (legacyGrid?.parentElement) legacyGrid.parentElement.appendChild(rootNode);
  else card.appendChild(rootNode);
  return rootNode;
}

function createFullscreen(item) {
  document.getElementById(OVERLAY_ID)?.remove();

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.innerHTML = `
    <div class="remoteops-fullscreen-shell" role="dialog" aria-modal="true" aria-label="Screenshot preview">
      <div class="remoteops-fullscreen-bar">
        <div class="remoteops-fullscreen-title"></div>
        <button type="button" class="remoteops-fullscreen-close">Close</button>
      </div>
      <div class="remoteops-fullscreen-body"><img alt="Screenshot preview" /></div>
    </div>`;

  const title = overlay.querySelector('.remoteops-fullscreen-title');
  const img = overlay.querySelector('img');
  title.textContent = `${item.currentUser || item.employeeName || 'Unknown User'} · ${item.display || item.displayName || 'Display'} · ${formatDate(item.capturedAt)}`;
  img.src = item.url;

  const close = () => overlay.remove();
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  overlay.querySelector('.remoteops-fullscreen-close')?.addEventListener('click', close);
  img.addEventListener('click', close);
  document.addEventListener('keydown', function onKey(e) {
    if (e.key !== 'Escape') return;
    close();
    document.removeEventListener('keydown', onKey);
  }, { once: true });
  document.body.appendChild(overlay);
}

function renderGallery(root, items, total) {
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  state.page = Math.min(Math.max(1, state.page), pageCount);
  const start = (state.page - 1) * PAGE_SIZE;
  const pageItems = items.slice(start, start + PAGE_SIZE);

  root.innerHTML = '';

  if (pageItems.length === 0) {
    root.innerHTML = '<div class="py-10 text-center text-sm text-muted">No screenshots match this filter.</div>';
    return;
  }

  const grid = document.createElement('div');
  grid.className = 'remoteops-gallery-grid';

  for (const item of pageItems) {
    const tile = document.createElement('div');
    tile.className = 'remoteops-gallery-tile';

    const imageWrap = document.createElement('button');
    imageWrap.type = 'button';
    imageWrap.className = 'remoteops-gallery-image-wrap';
    imageWrap.title = 'Click to view full screen';

    const image = document.createElement('img');
    image.className = 'remoteops-gallery-image';
    image.loading = 'lazy';
    image.src = item.url;
    image.alt = `${item.currentUser || item.employeeName || 'Unknown User'} screenshot`;
    imageWrap.appendChild(image);
    imageWrap.addEventListener('click', () => createFullscreen(item));

    const meta = document.createElement('div');
    meta.className = 'remoteops-gallery-meta';
    const user = document.createElement('div');
    user.className = 'remoteops-gallery-user';
    user.textContent = item.currentUser || item.employeeName || 'Unknown User';
    const sub = document.createElement('div');
    sub.className = 'remoteops-gallery-sub';
    sub.textContent = `${item.display || item.displayName || 'Display'} · ${formatDate(item.capturedAt)}`;
    meta.append(user, sub);

    tile.append(imageWrap, meta);
    grid.appendChild(tile);
  }
  root.appendChild(grid);

  const nav = document.createElement('div');
  nav.className = 'remoteops-gallery-pagination';

  const prev = document.createElement('button');
  prev.type = 'button';
  prev.textContent = 'Previous';
  prev.disabled = state.page <= 1;
  prev.addEventListener('click', () => { state.page -= 1; renderGallery(root, items, total); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  nav.appendChild(prev);

  const visiblePages = [];
  const first = Math.max(1, state.page - 2);
  const last = Math.min(pageCount, first + 4);
  for (let p = first; p <= last; p += 1) visiblePages.push(p);
  visiblePages.forEach(p => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = String(p);
    button.className = p === state.page ? 'active' : '';
    button.addEventListener('click', () => { state.page = p; renderGallery(root, items, total); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    nav.appendChild(button);
  });

  const next = document.createElement('button');
  next.type = 'button';
  next.textContent = 'Next';
  next.disabled = state.page >= pageCount;
  next.addEventListener('click', () => { state.page += 1; renderGallery(root, items, total); window.scrollTo({ top: 0, behavior: 'smooth' }); });
  nav.appendChild(next);

  root.appendChild(nav);

  const count = document.createElement('div');
  count.className = 'remoteops-gallery-count';
  count.textContent = `Showing ${start + 1}–${Math.min(start + PAGE_SIZE, total)} of ${total} screenshots · Page ${state.page} of ${pageCount}`;
  root.appendChild(count);
}

async function loadAllScreenshots(card, root, dashboard = false) {
  if (requestInFlight) return;
  requestInFlight = true;
  try {
    const filters = getFilters(card);
    const params = new URLSearchParams({ limit: String(MAX_ITEMS) });
    if (filters.employeeId && /^\d+$/.test(String(filters.employeeId))) params.set('employeeId', filters.employeeId);
    if (filters.date) params.set('date', filters.date);
    const response = await fetch(`${API_URL}/activity/screenshots?${params.toString()}`, { headers: headers() });
    if (!response.ok) return;
    const data = await response.json();
    cache = Array.isArray(data) ? data : [];
    state.employeeId = filters.employeeId;
    state.date = filters.date;

    if (dashboard) {
      renderDashboard(root, cache);
    } else {
      renderGallery(root, cache, cache.length);
    }
  } catch (_) {
    // Keep the existing UI during transient network errors.
  } finally {
    requestInFlight = false;
  }
}

function renderDashboard(root, items) {
  const latest = [...items].sort((a, b) => new Date(b.capturedAt) - new Date(a.capturedAt)).slice(0, 8);
  root.innerHTML = '';
  const grid = document.createElement('div');
  grid.className = 'remoteops-gallery-grid';
  for (const item of latest) {
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
    button.addEventListener('click', e => { e.stopPropagation(); createFullscreen(item); });
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
  }
  root.appendChild(grid);

  // Prevent any resize/range control inside the dashboard card from bubbling
  // into a parent navigation handler or the View All action.
  root.parentElement?.querySelectorAll('input[type="range"]').forEach(input => {
    input.addEventListener('click', e => e.stopPropagation());
    input.addEventListener('pointerdown', e => e.stopPropagation());
    input.addEventListener('mousedown', e => e.stopPropagation());
    input.addEventListener('change', e => e.stopPropagation());
  });
}

function enhance() {
  injectStyles();

  const fullPageCard = findFullPageCard();
  if (fullPageCard) {
    const root = hideLegacyGallery(fullPageCard);
    if (root) loadAllScreenshots(fullPageCard, root, false);
  }

  const dashboardCard = findDashboardCard();
  if (dashboardCard) {
    dashboardCard.classList.add('remoteops-dashboard-screenshot-card');
    const root = hideLegacyGallery(dashboardCard);
    if (root) loadAllScreenshots(dashboardCard, root, true);

    // Keep View All as the only navigation control. Range sliders and other
    // controls in this card should never trigger the surrounding card/button.
    dashboardCard.querySelectorAll('input[type="range"]').forEach(input => {
      input.addEventListener('click', e => e.stopPropagation());
      input.addEventListener('pointerdown', e => e.stopPropagation());
      input.addEventListener('mousedown', e => e.stopPropagation());
      input.addEventListener('change', e => e.stopPropagation());
    });
    dashboardCard.querySelectorAll('button').forEach(button => {
      if (/view all/i.test(textOf(button))) button.dataset.viewAllControl = 'true';
    });
  }
}

function start() {
  clearInterval(timer);
  timer = setInterval(() => { requestInFlight = false; enhance(); }, 5000);
  enhance();
}

const observer = new MutationObserver(() => enhance());
observer.observe(document.body, { childList: true, subtree: true });

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();

export {};
