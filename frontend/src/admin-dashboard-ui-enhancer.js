/* Admin Dashboard UI-only enhancement layer.
   This file intentionally does not modify application data or business logic.
   It only adds presentation classes and lightweight navigation affordances. */

const ADMIN_DASHBOARD_CLASS = 'admin-dashboard-mode';
const COMMAND_BAR_ID = 'admin-dashboard-command-bar';

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
      <p>Organization-wide visibility across staff activity, support, assets and monitoring.</p>
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
    if (label.includes('Active Working')) meta = 'Currently reporting active';
    if (label.includes('Idle Staff')) meta = 'Currently inactive by activity threshold';
    if (label.includes('Pending WFH')) meta = 'Awaiting manager/admin action';

    const metaNode = document.createElement('div');
    metaNode.className = 'admin-kpi-meta';
    metaNode.textContent = meta;
    card.appendChild(metaNode);
  });
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
    if (content.includes('Live Desktop View')) {
      card.classList.add('admin-monitoring-panel');
    }
    if (content.includes('Recent Screenshots')) {
      card.classList.add('admin-monitoring-panel');
    }
  });
}

function cleanup(main) {
  main?.classList.remove(ADMIN_DASHBOARD_CLASS);
  document.getElementById(COMMAND_BAR_ID)?.remove();
}

function enhance() {
  const main = document.querySelector('main');
  if (!main) return;

  if (!isAdminDashboard()) {
    cleanup(main);
    return;
  }

  addCommandBar(main);
  decorateDashboardSections(main);
  decorateKpis(main);
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
