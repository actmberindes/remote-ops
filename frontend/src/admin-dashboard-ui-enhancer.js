/* Admin Dashboard UI-only enhancement layer.
   This file intentionally does not modify application data or business logic.
   It only adds presentation classes and lightweight navigation affordances. */

const ADMIN_DASHBOARD_CLASS = 'admin-dashboard-mode';
const COMMAND_BAR_ID = 'admin-dashboard-command-bar';
const SECTION_LABELS = {
  workforce: 'Workforce & WFH Overview',
  operations: 'IT Operations',
  monitoring: 'Monitoring & Visibility',
};

function textOf(el) {
  return (el?.textContent || '').replace(/\s+/g, ' ').trim();
}

function isAdminDashboard() {
  const header = document.querySelector('header');
  const main = document.querySelector('main');
  return Boolean(header && main && textOf(header).includes('Admin Dashboard'));
}

function findNavButton(label) {
  return [...document.querySelectorAll('aside button')]
    .find(btn => textOf(btn).toLowerCase() === label.toLowerCase());
}

function goTo(label) {
  findNavButton(label)?.click();
}

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
      <div class="admin-dashboard-command-status">
        <span class="admin-dashboard-command-status-dot"></span>
        Dashboard data is live from the current workspace
      </div>
    </div>
    <div class="admin-dashboard-quick-actions" aria-label="Quick actions">
      <button type="button" data-admin-nav="Applications & Schedules">Applications</button>
      <button type="button" data-admin-nav="Tickets">Tickets</button>
      <button type="button" data-admin-nav="Assets">Assets</button>
      <button type="button" data-admin-nav="Live View">Live View</button>
    </div>
  `;

  bar.querySelectorAll('[data-admin-nav]').forEach(btn => {
    btn.addEventListener('click', () => goTo(btn.dataset.adminNav));
  });

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
  const grids = [...main.querySelectorAll('.grid')];
  const kpiGrid = grids.find(grid => {
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
  const candidates = [...main.querySelectorAll('.grid')];
  const opsGrid = candidates.find(grid => {
    const cards = [...grid.children].filter(el => el.classList.contains('card'));
    return cards.length === 4 && /Open Tickets/.test(textOf(grid)) && /Resolved Tickets/.test(textOf(grid)) && /Assets In Use/.test(textOf(grid)) && /Assets Available/.test(textOf(grid));
  });
  if (!opsGrid) return;
  opsGrid.classList.add('admin-ops-kpi-grid');
  addSectionLabel(main, 'operations', SECTION_LABELS.operations);
}

function decorateDashboardSections(main) {
  main.classList.add(ADMIN_DASHBOARD_CLASS);

  const cards = [...main.querySelectorAll('.card')];
  cards.forEach(card => {
    const content = textOf(card);
    if (content.includes('Live Employee Activity') || content.includes('Tickets by Status') || content.includes('Assets by Status')) {
      card.classList.add('admin-dashboard-panel');
    }
    if (content.includes('Live Status Roster')) {
      card.classList.add('admin-dashboard-roster');
    }
    if (content.includes('Live Desktop View') || content.includes('Recent Screenshots')) {
      card.classList.add('admin-monitoring-panel');
    }
  });

  addSectionLabel(main, 'monitoring', SECTION_LABELS.monitoring);
}

function cleanup(main) {
  main?.classList.remove(ADMIN_DASHBOARD_CLASS);
  document.getElementById(COMMAND_BAR_ID)?.remove();
  main?.querySelectorAll('.admin-dashboard-section-label').forEach(node => node.remove());
}

function enhance() {
  const main = document.querySelector('main');
  if (!main) return;

  if (!isAdminDashboard()) {
    cleanup(main);
    return;
  }

  addCommandBar(main);
  decorateKpis(main);
  decorateOperationsKpis(main);
  decorateDashboardSections(main);
}

let scheduled = false;
const scheduleEnhance = () => {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    enhance();
  });
};

const observer = new MutationObserver(scheduleEnhance);
observer.observe(document.body, { subtree: true, childList: true, characterData: true });

scheduleEnhance();
