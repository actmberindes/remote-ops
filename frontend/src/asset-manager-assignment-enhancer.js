const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.1.2:4000/api';
const TOKEN_KEY = 'rw_token';

let managersCache = null;
let managersPromise = null;

function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

async function loadManagers() {
  if (managersCache) return managersCache;
  if (managersPromise) return managersPromise;

  managersPromise = fetch(`${API_URL}/users`, {
    headers: getToken()
      ? { Authorization: `Bearer ${getToken()}` }
      : {},
  })
    .then(async response => {
      if (!response.ok) throw new Error(`Failed to load users (${response.status})`);
      const users = await response.json();
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

function isVisible(element) {
  return !!(element && element.offsetParent !== null);
}

async function enhanceAssignmentEmployeeSelector() {
  const headings = [...document.querySelectorAll('h3')].filter(isVisible);
  const heading = headings.find(h => h.textContent.trim().startsWith('Assign '));
  if (!heading) return;

  // Component assets (UPS Battery / SSD / RAM / Video Card) already use a
  // parent-asset selector, so only enhance the direct employee selector.
  const select = [...document.querySelectorAll('select')].find(select =>
    isVisible(select) &&
    [...select.options].some(option =>
      option.textContent.trim() === 'Select an employee…'
    )
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

let scheduled = false;
function scheduleEnhancement() {
  if (scheduled) return;
  scheduled = true;
  setTimeout(async () => {
    scheduled = false;
    await enhanceAssignmentEmployeeSelector();
  }, 50);
}

const observer = new MutationObserver(scheduleEnhancement);
observer.observe(document.documentElement, {
  childList: true,
  subtree: true,
});

scheduleEnhancement();
