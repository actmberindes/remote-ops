/* Paginated main Screenshots page.
   The existing React screenshot view only asks for the first 60 records. This
   enhancer gives the main Screenshots/Team Screenshots pages real pagination
   while leaving Dashboard Recent Screenshots unchanged. */

const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.1.2:4000/api';
const PAGE_SIZE = 60;
const STYLE_ID = 'remoteops-screenshot-pagination-style';
const ROOT_ATTR = 'data-remoteops-screenshot-pagination';
let observerStarted = false;

function textOf(el) {
  return (el?.textContent || '').replace(/\s+/g, ' ').trim();
}

function headers() {
  const token = localStorage.getItem('rw_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
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

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .remoteops-screenshot-pagination{width:100%}
    .remoteops-screenshot-pagination-controls{display:flex;flex-wrap:wrap;align-items:flex-end;gap:8px;margin:0 0 14px}
    .remoteops-screenshot-pagination-field{flex:1 1 220px;min-width:180px}
    .remoteops-screenshot-pagination-date{width:180px}
    .remoteops-screenshot-pagination-label{display:block;margin:0 0 4px;color:var(--text-muted);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}
    .remoteops-screenshot-pagination-input,.remoteops-screenshot-pagination-select{width:100%;height:36px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);padding:0 10px;font-size:11px;font-weight:600;outline:none}
    .remoteops-screenshot-pagination-clear{height:36px;padding:0 12px;border:1px solid var(--border);border-radius:8px;background:transparent;color:var(--text-muted);font-size:11px;font-weight:800;cursor:pointer}
    .remoteops-screenshot-pagination-clear:hover{color:var(--text)}
    .remoteops-screenshot-pagination-summary{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 0 10px}
    .remoteops-screenshot-pagination-summary-text{font-size:10px;color:var(--text-muted);font-weight:800}
    .remoteops-screenshot-pagination-bulk{display:flex;align-items:center;gap:8px}
    .remoteops-screenshot-pagination-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
    .remoteops-screenshot-pagination-tile{position:relative;min-width:0;border:1px solid var(--border);border-radius:10px;overflow:hidden;background:var(--surface)}
    .remoteops-screenshot-pagination-image-button{display:block;width:100%;padding:0;border:0;background:var(--bg);cursor:zoom-in}
    .remoteops-screenshot-pagination-image{display:block;width:100%;aspect-ratio:16/10;object-fit:cover}
    .remoteops-screenshot-pagination-meta{padding:7px 9px}
    .remoteops-screenshot-pagination-name{font-size:10px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .remoteops-screenshot-pagination-date{margin-top:2px;color:var(--text-muted);font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .remoteops-screenshot-pagination-check{position:absolute;top:7px;left:7px;z-index:2;width:16px;height:16px}
    .remoteops-screenshot-pagination-delete{position:absolute;top:5px;right:5px;z-index:2;border:0;border-radius:7px;padding:5px;background:rgba(0,0,0,.65);color:#fff;cursor:pointer}
    .remoteops-screenshot-pagination-delete:hover{background:var(--danger)}
    .remoteops-screenshot-pagination-nav{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:16px}
    .remoteops-screenshot-pagination-button{min-width:34px;height:32px;padding:0 10px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:11px;font-weight:800;cursor:pointer}
    .remoteops-screenshot-pagination-button:hover:not(:disabled){background:var(--bg)}
    .remoteops-screenshot-pagination-button:disabled{opacity:.45;cursor:not-allowed}
    .remoteops-screenshot-pagination-page{font-size:10px;color:var(--text-muted);font-weight:800;padding:0 6px}
    .remoteops-screenshot-fullscreen{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.9)}
    .remoteops-screenshot-fullscreen img{max-width:96vw;max-height:94vh;width:auto;height:auto;object-fit:contain;border-radius:8px}
    .remoteops-screenshot-fullscreen-close{position:absolute;top:16px;right:18px;width:38px;height:38px;border:1px solid rgba(255,255,255,.2);border-radius:999px;background:rgba(0,0,0,.55);color:#fff;font-size:22px;cursor:pointer}
    @media (max-width:1100px){.remoteops-screenshot-pagination-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
    @media (max-width:800px){.remoteops-screenshot-pagination-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media (max-width:520px){.remoteops-screenshot-pagination-grid{grid-template-columns:1fr}.remoteops-screenshot-pagination-date{width:100%}}
  `;
  document.head.appendChild(style);
}

function mainScreenshotCards() {
  return [...document.querySelectorAll('.card')].filter(card => {
    const heading = [...card.querySelectorAll('h3')].find(h => /^Screenshots$|^Team Screenshots$/i.test(textOf(h)));
    return Boolean(heading);
  });
}

function getHeader(card) {
  const heading = [...card.querySelectorAll('h3')].find(h => /^Screenshots$|^Team Screenshots$/i.test(textOf(h)));
  return heading?.parentElement?.parentElement || null;
}

function removeAfterHeader(card, header) {
  let node = header?.nextElementSibling;
  while (node) {
    const next = node.nextElementSibling;
    node.remove();
    node = next;
  }
}

function getState(root) {
  let state = root._remoteopsState;
  if (!state) {
    state = { page: 1, employeeId: '', date: '', selectedIds: [], loading: false, employees: [], employeesLoaded: false };
    root._remoteopsState = state;
  }
  return state;
}

async function getJson(path) {
  const response = await fetch(`${API_URL}${path}`, { headers: headers() });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}

async function loadEmployees(state) {
  try {
    const me = await getJson('/me');
    const users = await getJson('/users');
    const list = Array.isArray(users) ? users.filter(u => u.role === 'Employee') : [];
    state.employees = me?.role === 'Manager'
      ? list.filter(u => Number(u.managerId) === Number(me.id))
      : list;
  } catch (_) {
    state.employees = [];
  }
}

function openFullscreen(url, label) {
  const src = uploadUrl(url);
  if (!src) return;
  const overlay = document.createElement('div');
  overlay.className = 'remoteops-screenshot-fullscreen';
  overlay.innerHTML = `<button type="button" class="remoteops-screenshot-fullscreen-close" aria-label="Close">×</button><img alt="${escapeHtml(label)}" />`;
  overlay.querySelector('img').src = src;
  overlay.addEventListener('click', event => {
    if (event.target === overlay || event.target.closest('.remoteops-screenshot-fullscreen-close')) overlay.remove();
  });
  document.body.appendChild(overlay);
}

async function deleteOne(state, shot, render) {
  if (!window.confirm(`Delete this screenshot captured at ${new Date(shot.capturedAt).toLocaleString()}?`)) return;
  try {
    const response = await fetch(`${API_URL}/activity/screenshots/${encodeURIComponent(shot.id)}`, { method: 'DELETE', headers: headers() });
    if (!response.ok) throw new Error(`Delete failed (${response.status})`);
    state.selectedIds = state.selectedIds.filter(id => String(id) !== String(shot.id));
    await render();
  } catch (_) {
    alert('Unable to delete this screenshot.');
  }
}

async function deleteSelected(state, render) {
  if (!state.selectedIds.length) return;
  if (!window.confirm(`Delete ${state.selectedIds.length} selected screenshot${state.selectedIds.length === 1 ? '' : 's'}? This cannot be undone.`)) return;
  try {
    const response = await fetch(`${API_URL}/activity/screenshots/delete-bulk`, {
      method: 'POST',
      headers: { ...headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: state.selectedIds }),
    });
    if (!response.ok) throw new Error(`Bulk delete failed (${response.status})`);
    state.selectedIds = [];
    await render();
  } catch (_) {
    alert('Unable to delete the selected screenshots.');
  }
}

function tileHtml(shot, state) {
  const image = uploadUrl(shot.url);
  const label = `${shot.employeeName || 'Employee'} — ${new Date(shot.capturedAt).toLocaleString()}`;
  const checked = state.selectedIds.some(id => String(id) === String(shot.id)) ? 'checked' : '';
  return `<div class="remoteops-screenshot-pagination-tile">
    <input class="remoteops-screenshot-pagination-check" type="checkbox" data-shot-select="${escapeHtml(shot.id)}" ${checked} aria-label="Select screenshot" />
    <button type="button" class="remoteops-screenshot-pagination-image-button" data-shot-view="${escapeHtml(shot.id)}" title="Click to view full size">
      <img src="${escapeHtml(image)}" alt="${escapeHtml(label)}" class="remoteops-screenshot-pagination-image" loading="lazy" />
    </button>
    <button type="button" class="remoteops-screenshot-pagination-delete" data-shot-delete="${escapeHtml(shot.id)}" title="Delete Screenshot">×</button>
    <div class="remoteops-screenshot-pagination-meta"><div class="remoteops-screenshot-pagination-name">${escapeHtml(shot.employeeName || 'Unknown Employee')}</div><div class="remoteops-screenshot-pagination-date">${escapeHtml(new Date(shot.capturedAt).toLocaleString())}</div></div>
  </div>`;
}

async function renderCard(card, root, state) {
  if (state.loading) return;
  state.loading = true;
  root.innerHTML = `<div class="py-10 text-center text-sm text-muted">Loading screenshots…</div>`;

  try {
    if (!state.employeesLoaded) {
      await loadEmployees(state);
      state.employeesLoaded = true;
    }

    const params = new URLSearchParams({ page: String(state.page), pageSize: String(PAGE_SIZE) });
    if (state.employeeId) params.set('employeeId', state.employeeId);
    if (state.date) params.set('date', state.date);
    const payload = await getJson(`/activity/screenshots-page?${params.toString()}`);
    const shots = Array.isArray(payload?.items) ? payload.items : [];
    const total = Number(payload?.total) || 0;
    const totalPages = Math.max(1, Number(payload?.totalPages) || 1);
    state.page = Math.min(state.page, totalPages);

    const employeeOptions = state.employees.map(employee => `<option value="${escapeHtml(employee.id)}">${escapeHtml(employee.name)}</option>`).join('');
    const allSelected = shots.length > 0 && shots.every(shot => state.selectedIds.some(id => String(id) === String(shot.id)));

    root.innerHTML = `
      <div class="remoteops-screenshot-pagination-controls">
        <div class="remoteops-screenshot-pagination-field">
          <label class="remoteops-screenshot-pagination-label">Employee</label>
          <select class="remoteops-screenshot-pagination-select" data-shot-employee><option value="">All Employees</option>${employeeOptions}</select>
        </div>
        <div class="remoteops-screenshot-pagination-date">
          <label class="remoteops-screenshot-pagination-label">Capture Date</label>
          <input class="remoteops-screenshot-pagination-input" type="date" value="${escapeHtml(state.date)}" data-shot-date />
        </div>
        ${(state.employeeId || state.date) ? '<button type="button" class="remoteops-screenshot-pagination-clear" data-shot-clear>Clear</button>' : ''}
      </div>
      <div class="remoteops-screenshot-pagination-summary">
        <label class="remoteops-screenshot-pagination-bulk"><input type="checkbox" data-shot-select-all ${allSelected ? 'checked' : ''} /> <span class="remoteops-screenshot-pagination-summary-text">Select page</span></label>
        ${state.selectedIds.length ? `<button type="button" class="remoteops-screenshot-pagination-clear" data-shot-delete-selected>Delete ${state.selectedIds.length} Selected</button>` : `<span class="remoteops-screenshot-pagination-summary-text">${total} screenshot${total === 1 ? '' : 's'}</span>`}
      </div>
      ${shots.length ? `<div class="remoteops-screenshot-pagination-grid">${shots.map(shot => tileHtml(shot, state)).join('')}</div>` : '<div class="py-10 text-center text-sm text-muted">No screenshots match this filter.</div>'}
      <div class="remoteops-screenshot-pagination-nav">
        <button type="button" class="remoteops-screenshot-pagination-button" data-shot-prev ${state.page <= 1 ? 'disabled' : ''}>Previous</button>
        <span class="remoteops-screenshot-pagination-page">Page ${state.page} of ${totalPages}</span>
        <button type="button" class="remoteops-screenshot-pagination-button" data-shot-next ${state.page >= totalPages ? 'disabled' : ''}>Next</button>
      </div>
    `;

    const employeeSelect = root.querySelector('[data-shot-employee]');
    if (employeeSelect) {
      employeeSelect.value = state.employeeId;
      employeeSelect.addEventListener('change', () => {
        state.employeeId = employeeSelect.value;
        state.page = 1;
        state.selectedIds = [];
        renderCard(card, root, state);
      });
    }

    root.querySelector('[data-shot-date]')?.addEventListener('change', event => {
      state.date = event.target.value;
      state.page = 1;
      state.selectedIds = [];
      renderCard(card, root, state);
    });

    root.querySelector('[data-shot-clear]')?.addEventListener('click', () => {
      state.employeeId = '';
      state.date = '';
      state.page = 1;
      state.selectedIds = [];
      renderCard(card, root, state);
    });

    root.querySelector('[data-shot-prev]')?.addEventListener('click', () => {
      if (state.page <= 1) return;
      state.page -= 1;
      state.selectedIds = [];
      renderCard(card, root, state);
    });
    root.querySelector('[data-shot-next]')?.addEventListener('click', () => {
      if (state.page >= totalPages) return;
      state.page += 1;
      state.selectedIds = [];
      renderCard(card, root, state);
    });

    root.querySelector('[data-shot-select-all]')?.addEventListener('change', event => {
      const pageIds = shots.map(shot => String(shot.id));
      state.selectedIds = state.selectedIds.map(String);
      if (event.target.checked) {
        state.selectedIds = [...new Set([...state.selectedIds, ...pageIds])];
      } else {
        state.selectedIds = state.selectedIds.filter(id => !pageIds.includes(id));
      }
      renderCard(card, root, state);
    });

    root.querySelectorAll('[data-shot-select]').forEach(input => input.addEventListener('change', event => {
      const id = String(event.target.dataset.shotSelect);
      state.selectedIds = state.selectedIds.map(String);
      state.selectedIds = event.target.checked
        ? [...new Set([...state.selectedIds, id])]
        : state.selectedIds.filter(existing => existing !== id);
      renderCard(card, root, state);
    }));

    root.querySelectorAll('[data-shot-view]').forEach(button => button.addEventListener('click', () => {
      const shot = shots.find(item => String(item.id) === String(button.dataset.shotView));
      if (shot) openFullscreen(shot.url, `${shot.employeeName || 'Screenshot'} — ${new Date(shot.capturedAt).toLocaleString()}`);
    }));

    root.querySelectorAll('[data-shot-delete]').forEach(button => button.addEventListener('click', () => {
      const shot = shots.find(item => String(item.id) === String(button.dataset.shotDelete));
      if (shot) deleteOne(state, shot, () => renderCard(card, root, state));
    }));

    root.querySelector('[data-shot-delete-selected]')?.addEventListener('click', () => deleteSelected(state, () => renderCard(card, root, state)));
  } catch (_) {
    root.innerHTML = '<div class="py-10 text-center text-sm text-muted">Unable to load paginated screenshots.</div>';
  } finally {
    state.loading = false;
  }
}

function enhanceCard(card) {
  if (card.querySelector(`[${ROOT_ATTR}]`)) return;
  const header = getHeader(card);
  if (!header) return;
  removeAfterHeader(card, header);
  const root = document.createElement('div');
  root.className = 'remoteops-screenshot-pagination';
  root.setAttribute(ROOT_ATTR, 'true');
  card.appendChild(root);
  const state = getState(root);
  renderCard(card, root, state);
}

function startObserver() {
  if (observerStarted) return;
  observerStarted = true;
  injectStyles();
  const run = () => mainScreenshotCards().forEach(enhanceCard);
  const observer = new MutationObserver(run);
  observer.observe(document.body, { subtree: true, childList: true });
  run();
}

startObserver();
