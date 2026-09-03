/* Admin Dashboard UI-only enhancement layer.
   Presentation improvements only. Live workforce information is combined
   into the Live Status Roster so the dashboard does not duplicate status data. */

const ADMIN_DASHBOARD_CLASS = 'admin-dashboard-mode';
const COMMAND_BAR_ID = 'admin-dashboard-command-bar';
const SECTION_LABELS = { workforce: 'Workforce & WFH Overview', operations: 'IT Operations', monitoring: 'Monitoring & Visibility' };
const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.1.2:4000/api';
const LIVE_REFRESH_MS = 10000;
let liveMonitorTimer = null;
let liveMonitorActive = false;
let liveMonitorRequest = 0;

function textOf(el) { return (el?.textContent || '').replace(/\s+/g, ' ').trim(); }

function isAdminDashboard() {
  const header = document.querySelector('header');
  const main = document.querySelector('main');
  if (!header || !main || !textOf(header).includes('Admin Dashboard')) return false;
  const dashboardButton = [...document.querySelectorAll('aside button')].find(btn => textOf(btn).toLowerCase() === 'dashboard');
  return Boolean(dashboardButton?.classList.contains('nav-active'));
}

function findNavButton(label) {
  return [...document.querySelectorAll('aside button')].find(btn => textOf(btn).toLowerCase() === label.toLowerCase());
}
function goTo(label) { findNavButton(label)?.click(); }

function addCommandBar(main) {
  if (document.getElementById(COMMAND_BAR_ID)) return;
  const bar = document.createElement('section');
  bar.id = COMMAND_BAR_ID;
  bar.className = 'admin-dashboard-command-bar';
  bar.innerHTML = `
    <div class="admin-dashboard-command-copy">
      <div class="admin-dashboard-eyebrow">Operations Command Center</div>
      <h1>Admin Dashboard</h1>
      <p>Organization-wide visibility across workforce, IT support, assets and device monitoring.</p>
      <div class="admin-dashboard-command-status"><span class="admin-dashboard-command-status-dot"></span>Dashboard data is live from the current workspace</div>
    </div>
    <div class="admin-dashboard-quick-actions" aria-label="Quick actions">
      <button type="button" data-admin-nav="Applications & Schedules">Applications</button>
      <button type="button" data-admin-nav="Tickets">Tickets</button>
      <button type="button" data-admin-nav="Assets">Assets</button>
      <button type="button" data-admin-nav="Live View">Live View</button>
    </div>`;
  bar.querySelectorAll('[data-admin-nav]').forEach(btn => btn.addEventListener('click', () => goTo(btn.dataset.adminNav)));
  main.prepend(bar);
}

function addSectionLabel(main, marker, label) {
  if (main.querySelector(`[data-admin-section="${marker}"]`)) return;
  const node = document.createElement('div');
  node.className = 'admin-dashboard-section-label';
  node.dataset.adminSection = marker;
  node.textContent = label;
  const candidates = [...main.children];
  if (marker === 'workforce') {
    const target = candidates.find(el => el.classList.contains('grid') && [...el.querySelectorAll('.card')].some(card => /Total Staff|Active Working|Idle Staff|Pending WFH/.test(textOf(card))));
    target?.before(node);
  } else if (marker === 'operations') {
    const target = candidates.find(el => el.querySelector?.('.admin-ops-kpi-grid'));
    target?.before(node);
  } else if (marker === 'monitoring') {
    const target = candidates.find(el => textOf(el).includes('Live Desktop View') && textOf(el).includes('Recent Screenshots'));
    target?.before(node);
  }
}

function decorateKpis(main) {
  const kpiGrid = [...main.querySelectorAll('.grid')].find(grid => {
    const cards = [...grid.children].filter(el => el.classList.contains('card'));
    return cards.length === 4 && cards.every(card => /Total Staff|Active Working|Idle Staff|Pending WFH/.test(textOf(card)));
  });
  if (!kpiGrid) return;
  kpiGrid.classList.add('admin-kpi-grid');
  [...kpiGrid.children].forEach(card => {
    if (card.querySelector('.admin-kpi-meta')) return;
    const label = textOf(card);
    let meta = 'Current organization snapshot';
    if (label.includes('Total Staff')) meta = 'People tracked in workspace';
    if (label.includes('Active Working')) meta = 'Currently reporting active';
    if (label.includes('Idle Staff')) meta = 'Past the activity threshold';
    if (label.includes('Pending WFH')) meta = 'Awaiting approval action';
    const metaNode = document.createElement('div');
    metaNode.className = 'admin-kpi-meta';
    metaNode.textContent = meta;
    card.appendChild(metaNode);
  });
  addSectionLabel(main, 'workforce', SECTION_LABELS.workforce);
}

function decorateOperationsKpis(main) {
  const opsGrid = [...main.querySelectorAll('.grid')].find(grid => {
    const cards = [...grid.children].filter(el => el.classList.contains('card'));
    return cards.length === 4 && /Open Tickets/.test(textOf(grid)) && /Resolved Tickets/.test(textOf(grid)) && /Assets In Use/.test(textOf(grid)) && /Assets Available/.test(textOf(grid));
  });
  if (!opsGrid) return;
  opsGrid.classList.add('admin-ops-kpi-grid');
  addSectionLabel(main, 'operations', SECTION_LABELS.operations);
}

function findWorkforceCard(main) {
  return [...main.querySelectorAll('.card')].find(card => /Live Employee Activity|Live Workforce Status/.test(textOf(card))) || null;
}
function findRosterCard(main) { return [...main.querySelectorAll('.card')].find(card => textOf(card).includes('Live Status Roster')) || null; }

function combineWorkforceIntoRoster(main) {
  const workforceCard = findWorkforceCard(main);
  const rosterCard = findRosterCard(main);
  if (!workforceCard || !rosterCard) return;
  const workforceLayout = workforceCard.parentElement;
  workforceLayout?.classList.add('admin-workforce-layout');
  workforceCard.classList.add('admin-live-workforce-source');
  if (workforceCard !== rosterCard && workforceCard.isConnected) workforceCard.remove();
  rosterCard.classList.add('admin-live-roster-enhanced');
}

function decorateDashboardSections(main) {
  main.classList.add(ADMIN_DASHBOARD_CLASS);
  const cards = [...main.querySelectorAll('.card')];
  cards.forEach(card => {
    const content = textOf(card);
    if (content.includes('Live Employee Activity') || content.includes('Tickets by Status') || content.includes('Assets by Status')) card.classList.add('admin-dashboard-panel');
    if (content.includes('Live Status Roster')) card.classList.add('admin-dashboard-roster');
    if (content.includes('Live Desktop View') || content.includes('Recent Screenshots')) card.classList.add('admin-monitoring-panel');
  });
  combineWorkforceIntoRoster(main);
  addSectionLabel(main, 'monitoring', SECTION_LABELS.monitoring);
}

function createStatusLabel(status) {
  return { active: 'Active', idle: 'Idle', 'logged-out': 'No User', offline: 'Offline', pending: 'Pending', revoked: 'Revoked', 'no-device': 'No Device' }[status] || 'Unknown';
}
function statusTone(status) {
  return { active: 'success', idle: 'warning', 'logged-out': 'info', offline: 'neutral', pending: 'warning', revoked: 'danger', 'no-device': 'neutral' }[status] || 'neutral';
}
function initials(name) { return String(name || '?').split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase() || '?'; }
function statusDot(status) {
  const tones = { success: 'var(--success)', warning: 'var(--warning)', info: 'var(--info)', neutral: 'var(--neutral)', danger: 'var(--danger)' };
  return `<span class="admin-live-status-dot" style="background:${tones[statusTone(status)] || tones.neutral}"></span>`;
}
function formatLastSeen(value) {
  if (!value) return 'Never seen';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Unknown';
  const diff = Math.max(0, Date.now() - date.getTime());
  const seconds = Math.round(diff / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return date.toLocaleString();
}
function getAuthHeaders() {
  const token = localStorage.getItem('rw_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}
async function fetchDashboardMonitoring() {
  const headers = getAuthHeaders();
  const [usersRes, devicesRes] = await Promise.all([fetch(`${API_URL}/users`, { headers }), fetch(`${API_URL}/agent/devices`, { headers })]);
  if (!usersRes.ok) throw new Error(`Unable to load users (${usersRes.status})`);
  if (!devicesRes.ok) throw new Error(`Unable to load devices (${devicesRes.status})`);
  const [users, devices] = await Promise.all([usersRes.json(), devicesRes.json()]);
  return { users, devices };
}

function buildEmployeeRoster(users, devices) {
  const employees = users.filter(u => u.role === 'Employee');
  const byEmployee = new Map();
  devices.filter(d => d.enrolled !== false && !d.revoked && d.employeeId != null).forEach(device => {
    const key = Number(device.employeeId);
    const existing = byEmployee.get(key);
    const currentTime = new Date(device.lastSeenAt || 0).getTime();
    const existingTime = new Date(existing?.device?.lastSeenAt || 0).getTime();
    if (!existing || currentTime > existingTime) byEmployee.set(key, { device });
  });
  return employees.map(employee => {
    const device = byEmployee.get(Number(employee.id))?.device || null;
    return { employee, device, status: device?.status || 'no-device' };
  }).sort((a, b) => {
    const order = { active: 0, idle: 1, 'logged-out': 2, offline: 3, 'no-device': 4 };
    const ao = order[a.status] ?? 5;
    const bo = order[b.status] ?? 5;
    return ao !== bo ? ao - bo : String(a.employee.name || '').localeCompare(String(b.employee.name || ''));
  });
}
function buildStatusCounts(roster) {
  const counts = { active: 0, idle: 0, 'logged-out': 0, offline: 0, 'no-device': 0 };
  roster.forEach(item => { if (counts[item.status] !== undefined) counts[item.status] += 1; else counts.offline += 1; });
  return counts;
}

function renderRoster(card, roster) {
  if (!card) return;
  card.classList.add('admin-dashboard-roster', 'admin-live-roster-enhanced');
  const existingTitle = [...card.children].find(child => textOf(child).includes('Live Status Roster'));
  if (existingTitle) {
    existingTitle.innerHTML = `<span>Live Status Roster</span><span class="admin-roster-title-count">${roster.length} Employees</span>`;
    existingTitle.classList.add('admin-live-roster-title');
  }
  let content = card.querySelector('.admin-live-roster-content');
  if (!content) {
    [...card.children].forEach(child => { if (child !== existingTitle) child.remove(); });
    content = document.createElement('div');
    content.className = 'admin-live-roster-content';
    card.appendChild(content);
  }
  const counts = buildStatusCounts(roster);
  content.innerHTML = `
    <div class="admin-roster-summary">
      ${[['active','Active'],['idle','Idle'],['logged-out','No User'],['offline','Offline'],['no-device','No Device']].map(([key,label]) => `
        <button type="button" class="admin-roster-chip" data-roster-filter="${key}">${statusDot(key)}<span>${label}</span><strong>${counts[key]}</strong></button>
      `).join('')}
    </div>
    <div class="admin-roster-overview">
      <div class="admin-roster-overview-primary"><strong>${roster.length}</strong><span>Total employees</span></div>
      <div><strong>${counts.active + counts.idle + counts['logged-out']}</strong><span>Reporting</span></div>
      <div><strong>${Math.round(((counts.active + counts.idle + counts['logged-out']) / Math.max(roster.length,1)) * 100)}%</strong><span>Coverage</span></div>
    </div>
    <div class="admin-roster-tools">
      <input class="admin-roster-search" type="search" placeholder="Search employee, department, or device…" aria-label="Search live status roster" />
      <select class="admin-roster-filter" aria-label="Filter live status">
        <option value="all">All statuses</option><option value="active">Active</option><option value="idle">Idle</option><option value="logged-out">No User Logged In</option><option value="offline">Offline</option><option value="no-device">No Device</option>
      </select>
    </div>
    <div class="admin-roster-list"></div>
  `;
  const list = content.querySelector('.admin-roster-list');
  const searchInput = content.querySelector('.admin-roster-search');
  const select = content.querySelector('.admin-roster-filter');
  const draw = () => {
    const q = String(searchInput.value || '').trim().toLowerCase();
    const currentFilter = select.value;
    const rows = (currentFilter === 'all' ? roster : roster.filter(item => item.status === currentFilter)).filter(({ employee, device }) => {
      if (!q) return true;
      return [employee.name, employee.department, employee.jobTitle, device?.deviceName, device?.hostname, device?.domainUser].filter(Boolean).join(' ').toLowerCase().includes(q);
    });
    if (rows.length === 0) { list.innerHTML = '<div class="admin-roster-empty">No employees match this view.</div>'; return; }
    list.innerHTML = rows.map(({ employee, device, status }) => {
      const deviceLabel = device?.deviceName || device?.hostname || 'No managed device';
      const userLabel = device?.domainUser || (status === 'logged-out' ? 'No user logged in' : employee.jobTitle || '—');
      return `<div class="admin-roster-row"><div class="admin-roster-avatar">${initials(employee.name)}</div><div class="admin-roster-main"><div class="admin-roster-name">${employee.name || 'Unknown Employee'}</div><div class="admin-roster-meta">${employee.department || '—'} · ${userLabel}</div><div class="admin-roster-device">${deviceLabel}</div></div><div class="admin-roster-state"><div class="admin-roster-status">${statusDot(status)}${createStatusLabel(status)}</div><div class="admin-roster-seen">${device ? formatLastSeen(device.lastSeenAt) : 'Not enrolled'}</div></div></div>`;
    }).join('');
  };
  content.querySelectorAll('[data-roster-filter]').forEach(button => button.addEventListener('click', () => { select.value = button.dataset.rosterFilter; draw(); }));
  searchInput.addEventListener('input', draw);
  select.addEventListener('change', draw);
  draw();
}

async function refreshLiveDashboard() {
  if (!liveMonitorActive || !isAdminDashboard()) return;
  const requestId = ++liveMonitorRequest;
  try {
    const { users, devices } = await fetchDashboardMonitoring();
    if (!liveMonitorActive || requestId !== liveMonitorRequest || !isAdminDashboard()) return;
    const roster = buildEmployeeRoster(users, devices);
    const main = document.querySelector('main');
    if (!main) return;
    combineWorkforceIntoRoster(main);
    renderRoster(findRosterCard(main), roster);
  } catch (_) {}
}
function startLiveDashboardMonitor() {
  if (liveMonitorActive) return;
  liveMonitorActive = true;
  refreshLiveDashboard();
  liveMonitorTimer = setInterval(refreshLiveDashboard, LIVE_REFRESH_MS);
}
function stopLiveDashboardMonitor() {
  liveMonitorActive = false;
  liveMonitorRequest += 1;
  if (liveMonitorTimer) { clearInterval(liveMonitorTimer); liveMonitorTimer = null; }
}
function cleanup(main) {
  stopLiveDashboardMonitor();
  main?.classList.remove(ADMIN_DASHBOARD_CLASS);
  document.getElementById(COMMAND_BAR_ID)?.remove();
  main?.querySelectorAll('.admin-dashboard-section-label').forEach(node => node.remove());
}
function enhance() {
  const main = document.querySelector('main');
  if (!main) return;
  if (!isAdminDashboard()) { if (liveMonitorActive) cleanup(main); else { main.classList.remove(ADMIN_DASHBOARD_CLASS); document.getElementById(COMMAND_BAR_ID)?.remove(); main.querySelectorAll('.admin-dashboard-section-label').forEach(node => node.remove()); } return; }
  addCommandBar(main);
  decorateKpis(main);
  decorateOperationsKpis(main);
  decorateDashboardSections(main);
  startLiveDashboardMonitor();
}
let scheduled = false;
const scheduleEnhance = () => { if (scheduled) return; scheduled = true; requestAnimationFrame(() => { scheduled = false; enhance(); }); };
const observer = new MutationObserver(scheduleEnhance);
observer.observe(document.body, { subtree: true, childList: true, characterData: true });
scheduleEnhance();
