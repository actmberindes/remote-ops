const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.1.2:4000/api';
const TOKEN_KEY = 'rw_token';

let managersCache = null;
let managersPromise = null;
let assetCache = null;
let assetPromise = null;

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

async function getJson(path) {
  const response = await fetch(`${API_URL}${path}`, {
    headers: getToken()
      ? { Authorization: `Bearer ${getToken()}` }
      : {},
  });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}

async function loadManagers() {
  if (managersCache) return managersCache;
  if (managersPromise) return managersPromise;

  managersPromise = getJson('/users')
    .then(users => {
      managersCache = Array.isArray(users)
        ? users.filter(user => user.role === 'Manager')
        : [];
      return managersCache;
    })
    .catch(() => [])
    .finally(() => {
      managersPromise = null;
    });

  return managersPromise;
}

async function loadAssets() {
  if (assetCache) return assetCache;
  if (assetPromise) return assetPromise;

  assetPromise = getJson('/assets')
    .then(assets => {
      assetCache = Array.isArray(assets) ? assets : [];
      return assetCache;
    })
    .catch(() => [])
    .finally(() => {
      assetPromise = null;
    });

  return assetPromise;
}

function isVisible(element) {
  return !!(element && element.offsetParent !== null);
}

async function enhanceAssignmentEmployeeSelector() {
  const headings = [...document.querySelectorAll('h3')].filter(isVisible);
  const heading = headings.find(h => h.textContent.trim().startsWith('Assign '));
  if (!heading) return;

  const select = [...document.querySelectorAll('select')].find(select =>
    isVisible(select) &&
    [...select.options].some(option => option.textContent.trim() === 'Select an employee…')
  );

  if (!select) return;

  const managers = await loadManagers();
  if (!managers.length) return;

  const existingManagerValues = new Set(
    [...select.options]
      .filter(option => option.dataset.remoteOpsManager === '1')
      .map(option => option.value)
  );

  managers.forEach(manager => {
    if (existingManagerValues.has(String(manager.id))) return;

    const option = document.createElement('option');
    option.value = manager.id;
    option.textContent = `${manager.name} — ${manager.department} (Manager)`;
    option.dataset.remoteOpsManager = '1';
    select.appendChild(option);
  });

  const label = select.closest('label')?.querySelector('span');
  if (label) label.textContent = 'Assign to Employee / Manager';
}

async function enhanceBulkAssignModal() {
  const headings = [...document.querySelectorAll('h3')].filter(isVisible);
  const heading = headings.find(h => h.textContent.trim().startsWith('Bulk Assign '));
  if (!heading) return;

  const modal = heading.closest('.card') || heading.parentElement?.parentElement;
  if (!modal || modal.dataset.remoteOpsBulkEnhanced === '1') return;

  const managers = await loadManagers();
  if (!managers.length) return;

  const employeeCheckboxes = [...modal.querySelectorAll('input[type="checkbox"]')];
  if (!employeeCheckboxes.length) return;

  const list = employeeCheckboxes[0].closest('div.flex') || employeeCheckboxes[0].parentElement?.parentElement?.parentElement;
  if (!list) return;

  const existingValues = new Set(employeeCheckboxes.map(input => input.value));
  const managerRows = document.createDocumentFragment();

  managers.forEach(manager => {
    if (existingValues.has(String(manager.id))) return;

    const label = document.createElement('label');
    label.className = 'flex items-center gap-2.5 p-2 rounded-lg border border-[var(--border)] text-xs hover-surface cursor-pointer';
    label.dataset.remoteOpsManagerRow = '1';
    label.dataset.remoteOpsUserId = String(manager.id);
    label.innerHTML = `
      <input type="checkbox" value="${String(manager.id)}" data-remote-ops-manager="1" />
      <div class="flex items-center justify-center rounded-lg font-bold shrink-0 accent-bg shadow-sm" style="width:22px;height:22px;font-size:8px">
        ${manager.name ? manager.name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase() : '??'}
      </div>
      <span class="font-medium">${manager.name || 'Manager'}</span>
      <span class="text-muted ml-auto">${manager.department || ''} · Manager</span>
    `;
    managerRows.appendChild(label);
  });

  list.appendChild(managerRows);

  const description = [...modal.querySelectorAll('p')].find(p => p.textContent.includes('Select multiple employees'));
  if (description) {
    description.textContent = 'Select multiple employees and/or managers to share this asset.';
  }

  const button = [...modal.querySelectorAll('button')].find(button => /^Assign to/.test(button.textContent.trim()));
  if (!button) return;

  button.addEventListener('click', async event => {
    const managerInputs = [...modal.querySelectorAll('input[data-remote-ops-manager="1"]')];
    if (!managerInputs.some(input => input.checked)) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    const selectedIds = [
      ...[...modal.querySelectorAll('input[type="checkbox"]')]
        .filter(input => input.checked)
        .map(input => Number(input.value))
        .filter(Number.isFinite)
    ];

    if (!selectedIds.length) return;

    const headingText = heading.textContent.trim();
    const assetName = headingText.replace(/^Bulk Assign\s+/, '').trim();
    const assets = await loadAssets();
    const asset = assets.find(item => item.name === assetName);
    if (!asset) {
      window.alert('Unable to identify the asset for bulk assignment. Please close and reopen the dialog.');
      return;
    }

    button.disabled = true;
    const originalText = button.textContent;
    button.textContent = 'Assigning…';

    try {
      await getJson(`/assets/${asset.id}`); // confirms the token/session is still valid
      const response = await fetch(`${API_URL}/assets/${asset.id}/bulk-assign`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(getToken() ? { Authorization: `Bearer ${getToken()}` } : {}),
        },
        body: JSON.stringify({ employeeIds: selectedIds }),
      });

      let data = {};
      try { data = await response.json(); } catch (_) {}
      if (!response.ok) throw new Error(data.error || `Request failed (${response.status})`);

      window.location.reload();
    } catch (error) {
      window.alert(error.message || 'Bulk assignment failed.');
      button.disabled = false;
      button.textContent = originalText;
    }
  }, true);

  modal.dataset.remoteOpsBulkEnhanced = '1';
}

let scheduled = false;
function scheduleEnhancement() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(async () => {
    scheduled = false;
    await enhanceAssignmentEmployeeSelector();
    await enhanceBulkAssignModal();
  }, 50);
}

const observer = new MutationObserver(scheduleEnhancement);
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
});

scheduleEnhancement();
