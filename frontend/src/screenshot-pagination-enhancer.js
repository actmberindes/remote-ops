/* Main Screenshots page pagination enhancer. */
const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.1.2:4000/api';
const PAGE_SIZE = 60;
const STYLE_ID = 'remoteops-screenshot-pagination-style';
const stateByCard = new WeakMap();
let observerStarted = false;

const textOf = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
const headers = () => {
  const token = localStorage.getItem('rw_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
};
const uploadUrl = url => {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  return `${API_URL.replace(/\/api\/?$/, '')}${url}`;
};
const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .remoteops-shot-root{width:100%}
    .remoteops-shot-controls{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin:0 0 14px}
    .remoteops-shot-field{flex:1 1 220px;min-width:180px}
    .remoteops-shot-date{width:180px}
    .remoteops-shot-label{display:block;margin:0 0 4px;color:var(--text-muted);font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}
    .remoteops-shot-input,.remoteops-shot-select{width:100%;height:36px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);padding:0 10px;font-size:11px;font-weight:600;outline:none}
    .remoteops-shot-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}
    .remoteops-shot-tile{position:relative;min-width:0;border:1px solid var(--border);border-radius:10px;overflow:hidden;background:var(--surface)}
    .remoteops-shot-image-button{display:block;width:100%;padding:0;border:0;background:var(--bg);cursor:zoom-in}
    .remoteops-shot-image{display:block;width:100%;aspect-ratio:16/10;object-fit:cover}
    .remoteops-shot-meta{padding:8px 9px}
    .remoteops-shot-name{font-size:10px;font-weight:800;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .remoteops-shot-date-text{margin-top:2px;color:var(--text-muted);font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    .remoteops-shot-check{position:absolute;top:7px;left:7px;z-index:2;width:16px;height:16px}
    .remoteops-shot-delete{position:absolute;top:5px;right:5px;z-index:2;border:0;border-radius:7px;padding:5px;background:rgba(0,0,0,.65);color:#fff;cursor:pointer}
    .remoteops-shot-delete:hover{background:var(--danger)}
    .remoteops-shot-summary{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 10px}
    .remoteops-shot-small{font-size:10px;color:var(--text-muted);font-weight:800}
    .remoteops-shot-btn{height:32px;padding:0 11px;border:1px solid var(--border);border-radius:8px;background:var(--surface);color:var(--text);font-size:11px;font-weight:800;cursor:pointer}
    .remoteops-shot-btn:hover:not(:disabled){background:var(--bg)}
    .remoteops-shot-btn:disabled{opacity:.45;cursor:not-allowed}
    .remoteops-shot-nav{display:flex;justify-content:center;align-items:center;gap:7px;margin-top:16px}
    .remoteops-shot-fullscreen{position:fixed;inset:0;z-index:10000;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.9)}
    .remoteops-shot-fullscreen img{max-width:96vw;max-height:94vh;width:auto;height:auto;object-fit:contain;border-radius:8px}
    .remoteops-shot-close{position:absolute;top:16px;right:18px;width:38px;height:38px;border:1px solid rgba(255,255,255,.2);border-radius:999px;background:rgba(0,0,0,.55);color:#fff;font-size:22px;cursor:pointer}
    @media (max-width:1100px){.remoteops-shot-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
    @media (max-width:800px){.remoteops-shot-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media (max-width:520px){.remoteops-shot-grid{grid-template-columns:1fr}.remoteops-shot-date{width:100%}}
  `;
  document.head.appendChild(style);
}

function getCards() {
  return [...document.querySelectorAll('.card')].filter(card =>
    [...card.querySelectorAll('h3')].some(h => /^Screenshots$|^Team Screenshots$/i.test(textOf(h)))
  );
}

function getHeader(card) {
  const heading = [...card.querySelectorAll('h3')].find(h => /^Screenshots$|^Team Screenshots$/i.test(textOf(h)));
  return heading?.parentElement?.parentElement || null;
}

function getState(card) {
  let state = stateByCard.get(card);
  if (!state) {
    state = { page: 1, employeeId: '', date: '', selectedIds: new Set(), employees: [], employeesLoaded: false, rendering: false };
    stateByCard.set(card, state);
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
    const me = await getJson('/auth/me');
    const users = await getJson('/users');
    const list = Array.isArray(users) ? users.filter(u => u.role === 'Employee') : [];
    const current = me?.user || me;
    state.employees = current?.role === 'Manager'
      ? list.filter(u => Number(u.managerId) === Number(current.id))
      : list;
  } catch (_) {
    state.employees = [];
  }
}

function openFullscreen(url, label) {
  const src = uploadUrl(url);
  if (!src) return;
  const overlay = document.createElement('div');
  overlay.className = 'remoteops-shot-fullscreen';
  overlay.innerHTML = `<button type="button" class="remoteops-shot-close" aria-label="Close">×</button><img alt="${esc(label)}" src="${esc(src)}" />`;
  overlay.addEventListener('click', event => {
    if (event.target === overlay || event.target.closest('.remoteops-shot-close')) overlay.remove();
  });
  document.body.appendChild(overlay);
}

function clearAfterHeader(card, header, root) {
  let node = header?.nextElementSibling;
  while (node) {
    const next = node.nextElementSibling;
    if (node !== root) node.remove();
    node = next;
  }
}

function tileHtml(shot, state) {
  const image = uploadUrl(shot.url);
  const label = `${shot.employeeName || 'Employee'} — ${new Date(shot.capturedAt).toLocaleString()}`;
  const checked = state.selectedIds.has(String(shot.id)) ? 'checked' : '';
  return `<div class="remoteops-shot-tile">
    <input class="remoteops-shot-check" type="checkbox" data-shot-select="${esc(shot.id)}" ${checked} aria-label="Select screenshot" />
    <button type="button" class="remoteops-shot-image-button" data-shot-view="${esc(shot.id)}" title="Click to view full size"><img class="remoteops-shot-image" loading="lazy" src="${esc(image)}" alt="${esc(label)}" /></button>
    <button type="button" class="remoteops-shot-delete" data-shot-delete="${esc(shot.id)}" title="Delete screenshot">×</button>
    <div class="remoteops-shot-meta"><div class="remoteops-shot-name">${esc(shot.employeeName || 'Unknown Employee')}</div><div class="remoteops-shot-date-text">${esc(new Date(shot.capturedAt).toLocaleString())}</div></div>
  </div>`;
}

async function render(card) {
  const header = getHeader(card);
  if (!header) return;
  const state = getState(card);
  if (state.rendering) return;
  state.rendering = true;

  let root = card.querySelector('[data-remoteops-shot-root]');
  if (!root) {
    root = document.createElement('div');
    root.className = 'remoteops-shot-root';
    root.dataset.remoteopsShotRoot = 'true';
    card.appendChild(root);
  }
  clearAfterHeader(card, header, root);
  root.innerHTML = '<div class="py-10 text-center text-sm text-muted">Loading screenshots…</div>';

  try {
    if (!state.employeesLoaded) {
      await loadEmployees(state);
      state.employeesLoaded = true;
    }

    const params = new URLSearchParams({ page: String(state.page), pageSize: String(PAGE_SIZE) });
    if (state.employeeId) params.set('employeeId', state.employeeId);
    if (state.date) params.set('date', state.date);

    const payload = await getJson(`/activity/screenshots-page?${params.toString()}`);
    const items = Array.isArray(payload.items) ? payload.items : [];
    const total = Number(payload.total) || 0;
    const totalPages = Math.max(1, Number(payload.totalPages) || 1);
    state.page = Math.min(state.page, totalPages);
    const employeeOptions = state.employees.map(employee => `<option value="${esc(employee.id)}">${esc(employee.name)}</option>`).join('');
    const allSelected = items.length > 0 && items.every(item => state.selectedIds.has(String(item.id)));

    root.innerHTML = `
      <div class="remoteops-shot-controls">
        <div class="remoteops-shot-field"><label class="remoteops-shot-label">Employee</label><select class="remoteops-shot-select" data-shot-employee><option value="">All Employees</option>${employeeOptions}</select></div>
        <div class="remoteops-shot-date"><label class="remoteops-shot-label">Capture Date</label><input class="remoteops-shot-input" type="date" value="${esc(state.date)}" data-shot-date /></div>
        ${(state.employeeId || state.date) ? '<button type="button" class="remoteops-shot-btn" data-shot-clear>Clear</button>' : ''}
      </div>
      <div class="remoteops-shot-summary"><label class="remoteops-shot-small"><input type="checkbox" data-shot-select-all ${allSelected ? 'checked' : ''}/> Select page</label>${state.selectedIds.size ? `<button type="button" class="remoteops-shot-btn" data-shot-delete-selected>Delete ${state.selectedIds.size} Selected</button>` : `<span class="remoteops-shot-small">${total} screenshot${total === 1 ? '' : 's'}</span>`}</div>
      ${items.length ? `<div class="remoteops-shot-grid">${items.map(item => tileHtml(item, state)).join('')}</div>` : '<div class="py-10 text-center text-sm text-muted">No screenshots match this filter.</div>'}
      <div class="remoteops-shot-nav"><button type="button" class="remoteops-shot-btn" data-shot-prev ${state.page <= 1 ? 'disabled' : ''}>Previous</button><span class="remoteops-shot-small">Page ${state.page} of ${totalPages}</span><button type="button" class="remoteops-shot-btn" data-shot-next ${state.page >= totalPages ? 'disabled' : ''}>Next</button></div>`;

    const employee = root.querySelector('[data-shot-employee]');
    if (employee) {
      employee.value = state.employeeId;
      employee.addEventListener('change', () => { state.employeeId = employee.value; state.page = 1; state.selectedIds.clear(); render(card); });
    }
    root.querySelector('[data-shot-date]')?.addEventListener('change', e => { state.date = e.target.value; state.page = 1; state.selectedIds.clear(); render(card); });
    root.querySelector('[data-shot-clear]')?.addEventListener('click', () => { state.employeeId = ''; state.date = ''; state.page = 1; state.selectedIds.clear(); render(card); });
    root.querySelector('[data-shot-prev]')?.addEventListener('click', () => { if (state.page > 1) { state.page -= 1; state.selectedIds.clear(); render(card); } });
    root.querySelector('[data-shot-next]')?.addEventListener('click', () => { if (state.page < totalPages) { state.page += 1; state.selectedIds.clear(); render(card); } });
    root.querySelector('[data-shot-select-all]')?.addEventListener('change', e => { items.forEach(item => e.target.checked ? state.selectedIds.add(String(item.id)) : state.selectedIds.delete(String(item.id))); render(card); });
    root.querySelectorAll('[data-shot-select]').forEach(input => input.addEventListener('change', () => { const id = String(input.dataset.shotSelect); input.checked ? state.selectedIds.add(id) : state.selectedIds.delete(id); render(card); }));
    root.querySelectorAll('[data-shot-view]').forEach(button => button.addEventListener('click', () => { const shot = items.find(item => String(item.id) === String(button.dataset.shotView)); if (shot) openFullscreen(shot.url, `${shot.employeeName || 'Employee'} — ${new Date(shot.capturedAt).toLocaleString()}`); }));
    root.querySelectorAll('[data-shot-delete]').forEach(button => button.addEventListener('click', async () => {
      const shot = items.find(item => String(item.id) === String(button.dataset.shotDelete));
      if (!shot || !window.confirm(`Delete this screenshot captured at ${new Date(shot.capturedAt).toLocaleString()}?`)) return;
      const response = await fetch(`${API_URL}/activity/screenshots/${encodeURIComponent(shot.id)}`, { method: 'DELETE', headers: headers() });
      if (!response.ok) { alert('Unable to delete this screenshot.'); return; }
      state.selectedIds.delete(String(shot.id));
      if (items.length === 1 && state.page > 1) state.page -= 1;
      render(card);
    }));
    root.querySelector('[data-shot-delete-selected]')?.addEventListener('click', async () => {
      if (!state.selectedIds.size || !window.confirm(`Delete ${state.selectedIds.size} selected screenshots? This cannot be undone.`)) return;
      const response = await fetch(`${API_URL}/activity/screenshots/delete-bulk`, { method: 'POST', headers: { ...headers(), 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [...state.selectedIds] }) });
      if (!response.ok) { alert('Unable to delete the selected screenshots.'); return; }
      state.selectedIds.clear();
      render(card);
    });
  } catch (error) {
    root.innerHTML = '<div class="py-10 text-center text-sm text-muted">Unable to load screenshots right now.</div>';
    console.error('Remote Ops screenshot pagination:', error);
  } finally {
    state.rendering = false;
  }
}

function enhance() { getCards().forEach(render); }

function start() {
  if (observerStarted) return;
  observerStarted = true;
  injectStyles();
  enhance();
  const observer = new MutationObserver(() => enhance());
  observer.observe(document.body, { childList: true, subtree: true });
}

start();
