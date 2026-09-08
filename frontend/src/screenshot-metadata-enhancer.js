/* Screenshot page enhancement:
   - Loads the complete screenshot history in 200-item API pages.
   - Displays the results with client-side pagination so long histories stay usable.
   - Keeps Current User + Display + Date metadata visible on every tile.
   - Preserves employee/date filters and supports individual/bulk deletion. */
const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.1.2:4000/api';
const PAGE_SIZE = 36;
const FETCH_BATCH_SIZE = 200;
const REFRESH_MS = 10000;
const STYLE_ID = 'remoteops-screenshot-pagination-style';
const ROOT_ID = 'remoteops-screenshot-pagination-root';

let allShots = [];
let currentPage = 1;
let requestInFlight = false;
let lastFilterKey = '';
let refreshTimer = null;

function authHeaders() {
  const token = localStorage.getItem('rw_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function apiFileUrl(path) {
  if (!path) return '';
  if (path.startsWith('/uploads/')) return `${API_URL.replace(/\/api$/, '')}${path}`;
  return path;
}

function formatDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric'
  });
}

function formatDateTime(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit'
  });
}

function findScreenshotsCard() {
  return [...document.querySelectorAll('.card')].find(card => {
    const title = (card.querySelector('h3')?.textContent || '').trim();
    return /^Screenshots$/i.test(title) && card.querySelector('input[type="date"]');
  }) || null;
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${ROOT_ID}{margin-top:4px}
    .remoteops-shot-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
    @media (min-width:768px){.remoteops-shot-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
    .remoteops-shot-tile{position:relative;overflow:hidden;border:1px solid var(--border);border-radius:9px;background:var(--surface)}
    .remoteops-shot-image{display:block;width:100%;aspect-ratio:16/10;object-fit:cover;background:var(--bg);cursor:zoom-in}
    .remoteops-shot-body{padding:8px 9px 10px}
    .remoteops-shot-meta{font-size:10px;font-weight:700;line-height:1.3;color:var(--text-muted);white-space:normal}
    .remoteops-shot-meta strong{color:var(--text)}
    .remoteops-shot-file{margin-top:3px;font-size:9px;color:var(--text-muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .remoteops-shot-delete{position:absolute;top:7px;right:7px;padding:6px;border:0;border-radius:7px;background:rgba(0,0,0,.62);color:#fff;cursor:pointer}
    .remoteops-shot-delete:hover{background:var(--danger)}
    .remoteops-shot-select{position:absolute;top:8px;left:8px;width:16px;height:16px;z-index:2;accent-color:var(--accent)}
    .remoteops-shot-toolbar{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 12px;padding:0 2px;flex-wrap:wrap}
    .remoteops-shot-toolbar-left,.remoteops-shot-toolbar-right{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
    .remoteops-shot-toolbar label{display:flex;align-items:center;gap:6px;font-size:10px;font-weight:700;color:var(--text-muted);cursor:pointer}
    .remoteops-shot-range{font-size:10px;font-weight:700;color:var(--text-muted)}
    .remoteops-shot-pages{display:flex;align-items:center;justify-content:center;gap:5px;margin-top:14px;flex-wrap:wrap}
    .remoteops-shot-page-btn{min-width:31px;height:30px;padding:0 9px;border:1px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text);font-size:10px;font-weight:800;cursor:pointer}
    .remoteops-shot-page-btn:hover{background:var(--bg)}
    .remoteops-shot-page-btn.active{background:var(--accent);border-color:var(--accent);color:#fff}
    .remoteops-shot-page-btn:disabled{opacity:.45;cursor:default}
    .remoteops-shot-empty{padding:38px 10px;text-align:center;font-size:11px;color:var(--text-muted)}
    .remoteops-shot-loading{padding:18px 10px;text-align:center;font-size:11px;color:var(--text-muted)}
    @media (max-width:640px){.remoteops-shot-grid{grid-template-columns:1fr}.remoteops-shot-toolbar{align-items:flex-start;flex-direction:column}}
  `;
  document.head.appendChild(style);
}

function filterValues(card) {
  return {
    employeeId: card?.querySelector('select')?.value || '',
    date: card?.querySelector('input[type="date"]')?.value || '',
  };
}

function filterKey(filters) {
  return `${filters.employeeId}|${filters.date}`;
}

async function fetchAllScreenshots(filters) {
  const records = [];
  let offset = 0;

  while (true) {
    const params = new URLSearchParams({
      limit: String(FETCH_BATCH_SIZE),
      offset: String(offset),
    });
    if (filters.employeeId) params.set('employeeId', filters.employeeId);
    if (filters.date) params.set('date', filters.date);

    const response = await fetch(`${API_URL}/activity/screenshots?${params.toString()}`, {
      headers: authHeaders(),
    });

    if (!response.ok) throw new Error(`Screenshot request failed (${response.status})`);
    const page = await response.json();
    if (!Array.isArray(page) || page.length === 0) break;

    records.push(...page);
    if (page.length < FETCH_BATCH_SIZE) break;
    offset += page.length;
  }

  return records;
}

function hideReactScreenshotGrid(card) {
  const candidates = [...card.querySelectorAll('.grid')].filter(node => node.querySelector('img'));
  for (const grid of candidates) {
    if (!grid.closest(`#${ROOT_ID}`)) grid.style.display = 'none';
  }

  [...card.querySelectorAll('label,button')].forEach(node => {
    if (node.closest(`#${ROOT_ID}`)) return;
    const text = (node.textContent || '').trim();
    if (/^Select All$|Delete Selected|\d+ selected/i.test(text)) {
      const parent = node.parentElement;
      if (parent) parent.style.display = 'none';
    }
  });
}

function getRoot(card) {
  let root = card.querySelector(`#${ROOT_ID}`);
  if (!root) {
    root = document.createElement('div');
    root.id = ROOT_ID;
    const grids = [...card.querySelectorAll('.grid')].filter(node => node.querySelector('img'));
    const anchor = grids[0] || null;
    if (anchor?.parentElement) anchor.parentElement.appendChild(root);
    else card.appendChild(root);
  }
  return root;
}

function shotTile(shot, selected, onDelete) {
  const tile = document.createElement('div');
  tile.className = 'remoteops-shot-tile';

  const select = document.createElement('input');
  select.type = 'checkbox';
  select.className = 'remoteops-shot-select';
  select.checked = selected;
  select.dataset.shotId = String(shot.id);
  tile.appendChild(select);

  const image = document.createElement('img');
  image.className = 'remoteops-shot-image';
  image.loading = 'lazy';
  image.src = apiFileUrl(shot.url);
  image.alt = `${shot.currentUser || shot.employeeName || 'Unknown User'} screenshot`;
  tile.appendChild(image);

  const deleteButton = document.createElement('button');
  deleteButton.type = 'button';
  deleteButton.className = 'remoteops-shot-delete';
  deleteButton.title = 'Delete Screenshot';
  deleteButton.textContent = '×';
  deleteButton.addEventListener('click', () => onDelete(shot));
  tile.appendChild(deleteButton);

  const body = document.createElement('div');
  body.className = 'remoteops-shot-body';

  const meta = document.createElement('div');
  meta.className = 'remoteops-shot-meta';
  const user = shot.currentUser || shot.employeeName || 'Unknown User';
  const display = shot.display || shot.displayName || `Display ${Number(shot.displayIndex) || 1}`;
  meta.textContent = `${user} · ${display} · ${formatDate(shot.capturedAt)}`;
  body.appendChild(meta);

  const file = document.createElement('div');
  file.className = 'remoteops-shot-file';
  file.title = shot.filename || '';
  file.textContent = shot.filename || formatDateTime(shot.capturedAt);
  body.appendChild(file);

  tile.appendChild(body);
  return tile;
}

function pageButtons(totalPages) {
  const buttons = [];
  const add = (label, page, disabled = false, active = false) => buttons.push({ label, page, disabled, active });
  add('‹', Math.max(1, currentPage - 1), currentPage === 1);

  const start = Math.max(1, currentPage - 2);
  const end = Math.min(totalPages, currentPage + 2);
  if (start > 1) add('1', 1, false, currentPage === 1);
  if (start > 2) add('…', null, true);
  for (let p = start; p <= end; p += 1) add(String(p), p, false, p === currentPage);
  if (end < totalPages - 1) add('…', null, true);
  if (end < totalPages) add(String(totalPages), totalPages, false, currentPage === totalPages);
  add('›', Math.min(totalPages, currentPage + 1), currentPage === totalPages);
  return buttons;
}

function render() {
  const card = findScreenshotsCard();
  if (!card) return;

  hideReactScreenshotGrid(card);
  const root = getRoot(card);
  root.innerHTML = '';

  const total = allShots.length;
  if (total === 0) {
    const empty = document.createElement('div');
    empty.className = 'remoteops-shot-empty';
    empty.textContent = 'No screenshots match this filter.';
    root.appendChild(empty);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  currentPage = Math.min(Math.max(currentPage, 1), totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageShots = allShots.slice(pageStart, pageStart + PAGE_SIZE);
  const selectedIds = new Set();

  const toolbar = document.createElement('div');
  toolbar.className = 'remoteops-shot-toolbar';

  const left = document.createElement('div');
  left.className = 'remoteops-shot-toolbar-left';
  const selectAllLabel = document.createElement('label');
  const selectAll = document.createElement('input');
  selectAll.type = 'checkbox';
  selectAllLabel.appendChild(selectAll);
  selectAllLabel.append('Select page');
  left.appendChild(selectAllLabel);

  const range = document.createElement('span');
  range.className = 'remoteops-shot-range';
  range.textContent = `Showing ${pageStart + 1}–${Math.min(pageStart + PAGE_SIZE, total)} of ${total}`;
  left.appendChild(range);

  const right = document.createElement('div');
  right.className = 'remoteops-shot-toolbar-right';
  const deleteSelected = document.createElement('button');
  deleteSelected.type = 'button';
  deleteSelected.className = 'remoteops-shot-page-btn';
  deleteSelected.textContent = 'Delete Selected';
  deleteSelected.disabled = true;
  right.appendChild(deleteSelected);

  toolbar.append(left, right);
  root.appendChild(toolbar);

  const grid = document.createElement('div');
  grid.className = 'remoteops-shot-grid';
  root.appendChild(grid);

  const setDeleteState = () => {
    deleteSelected.disabled = selectedIds.size === 0;
    deleteSelected.textContent = selectedIds.size ? `Delete Selected (${selectedIds.size})` : 'Delete Selected';
    selectAll.checked = pageShots.length > 0 && pageShots.every(s => selectedIds.has(String(s.id)));
  };

  const deleteOne = async (shot) => {
    if (!window.confirm(`Delete this screenshot captured at ${formatDateTime(shot.capturedAt)}?`)) return;
    try {
      const res = await fetch(`${API_URL}/activity/screenshots/${encodeURIComponent(shot.id)}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      let data = {};
      try { data = await res.json(); } catch (_) {}
      if (!res.ok) throw new Error(data.error || `Delete failed (${res.status})`);
      await load(true);
    } catch (error) {
      window.alert(error.message || 'Unable to delete screenshot.');
    }
  };

  const removeSelected = async () => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} selected screenshot${ids.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
    try {
      const res = await fetch(`${API_URL}/activity/screenshots/delete-bulk`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: ids.map(Number) }),
      });
      let data = {};
      try { data = await res.json(); } catch (_) {}
      if (!res.ok) throw new Error(data.error || `Bulk delete failed (${res.status})`);
      await load(true);
    } catch (error) {
      window.alert(error.message || 'Unable to delete screenshots.');
    }
  };

  for (const shot of pageShots) {
    const tile = shotTile(shot, false, deleteOne);
    const checkbox = tile.querySelector('input[type="checkbox"]');
    checkbox.addEventListener('change', () => {
      const id = String(shot.id);
      if (checkbox.checked) selectedIds.add(id);
      else selectedIds.delete(id);
      setDeleteState();
    });
    grid.appendChild(tile);
  }

  selectAll.addEventListener('change', () => {
    pageShots.forEach(shot => {
      const id = String(shot.id);
      if (selectAll.checked) selectedIds.add(id);
      else selectedIds.delete(id);
    });
    grid.querySelectorAll('input[type="checkbox"]').forEach((checkbox, index) => {
      checkbox.checked = selectAll.checked && index < pageShots.length;
    });
    setDeleteState();
  });
  deleteSelected.addEventListener('click', removeSelected);

  if (totalPages > 1) {
    const pages = document.createElement('div');
    pages.className = 'remoteops-shot-pages';
    for (const config of pageButtons(totalPages)) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `remoteops-shot-page-btn${config.active ? ' active' : ''}`;
      button.textContent = config.label;
      button.disabled = config.disabled;
      if (!config.disabled && config.page) {
        button.addEventListener('click', () => {
          currentPage = config.page;
          render();
          window.scrollTo({ top: card.getBoundingClientRect().top + window.scrollY - 90, behavior: 'smooth' });
        });
      }
      pages.appendChild(button);
    }
    root.appendChild(pages);
  }
}

async function load(resetPage = false) {
  const card = findScreenshotsCard();
  if (!card || requestInFlight) return;
  const filters = filterValues(card);
  const nextKey = filterKey(filters);
  if (resetPage || nextKey !== lastFilterKey) currentPage = 1;
  lastFilterKey = nextKey;
  requestInFlight = true;

  try {
    const next = await fetchAllScreenshots(filters);
    allShots = next;
    render();
  } catch (_) {
    // Leave the previous rendered data in place during transient request errors.
  } finally {
    requestInFlight = false;
  }
}

function wireFilters(card) {
  const controls = card.querySelectorAll('select, input[type="date"]');
  controls.forEach(control => {
    if (control.dataset.remoteOpsPaginationBound === 'true') return;
    control.dataset.remoteOpsPaginationBound = 'true';
    control.addEventListener('change', () => load(true));
  });
}

function start() {
  injectStyles();
  const boot = () => {
    const card = findScreenshotsCard();
    if (!card) return;
    wireFilters(card);
    load();
    clearInterval(refreshTimer);
    refreshTimer = setInterval(() => load(false), REFRESH_MS);
  };

  boot();
  const observer = new MutationObserver(() => {
    const card = findScreenshotsCard();
    if (card) {
      wireFilters(card);
      if (!document.getElementById(ROOT_ID)) load();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();

export {};
