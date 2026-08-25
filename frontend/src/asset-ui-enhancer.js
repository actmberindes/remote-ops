const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.1.2:4000/api';
const TOKEN_KEY = 'rw_token';

let assetCache = [];
let upsOptionsCache = [];

function token() {
  return localStorage.getItem(TOKEN_KEY);
}

async function getJson(path) {
  const res = await window.__remoteOpsOriginalFetch(`${API_URL}${path}`, {
    headers: token() ? { Authorization: `Bearer ${token()}` } : {},
  });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

function visible(el) {
  return !!(el && el.offsetParent !== null);
}

function activeAssetForm() {
  const forms = [...document.querySelectorAll('form')].filter(visible);
  return forms.find(form => form.querySelector('select') && [...form.querySelectorAll('select')].some(s => [...s.options].some(o => o.textContent === 'UPS')));
}

function addTypeOptions() {
  const additions = ['UPS Battery', 'SSD', 'RAM'];
  document.querySelectorAll('select').forEach(select => {
    const hasDesktop = [...select.options].some(o => o.textContent === 'Desktop');
    if (!hasDesktop || select.dataset.assetTypesEnhanced === '1') return;
    additions.forEach(type => {
      if (![...select.options].some(o => o.textContent === type)) {
        const option = document.createElement('option');
        option.textContent = type;
        option.value = type;
        select.appendChild(option);
      }
    });
    select.dataset.assetTypesEnhanced = '1';
  });
}

function addAssetCostAndQuantity() {
  const form = activeAssetForm();
  if (!form || form.dataset.assetFieldsEnhanced === '1') return;

  const labels = [...form.querySelectorAll('label')];
  const purchaseLabel = labels.find(label => label.textContent.trim().startsWith('Purchase Date'));
  if (!purchaseLabel) return;

  const wrap = document.createElement('label');
  wrap.className = 'block mb-3';
  wrap.dataset.assetEnhancerCost = '1';
  wrap.innerHTML = '<span class="block text-[11px] font-bold mb-1 text-muted uppercase tracking-wider">Cost</span><input class="w-full rounded-lg px-3 py-2 text-xs input-surface font-medium focus:outline-none focus:ring-1 focus:ring-[var(--accent)] transition-all" type="number" min="0" step="0.01" placeholder="0.00" data-asset-cost />';
  purchaseLabel.parentNode.parentNode.insertBefore(wrap, purchaseLabel.parentNode.nextSibling);

  const typeSelect = [...form.querySelectorAll('select')].find(s => [...s.options].some(o => o.textContent === 'UPS Battery'));
  if (typeSelect) {
    typeSelect.addEventListener('change', () => {
      if (typeSelect.value === 'UPS Battery' && !form.querySelector('[data-asset-quantity]')) {
        const q = document.createElement('label');
        q.className = 'block mb-3';
        q.dataset.assetEnhancerQuantity = '1';
        q.innerHTML = '<span class="block text-[11px] font-bold mb-1 text-muted uppercase tracking-wider">Quantity in Stock</span><input class="w-full rounded-lg px-3 py-2 text-xs input-surface font-medium focus:outline-none focus:ring-1 focus:ring-[var(--accent)] transition-all" type="number" min="0" step="1" placeholder="e.g. 10" data-asset-quantity />';
        const modelField = labels.find(label => label.textContent.trim().startsWith('Model'));
        (modelField?.parentNode || purchaseLabel.parentNode).parentNode.insertBefore(q, modelField?.parentNode || purchaseLabel.parentNode);
      }
      if (typeSelect.value !== 'UPS Battery') {
        form.querySelector('[data-asset-quantity]')?.closest('label')?.remove();
      }
    });
  }

  form.dataset.assetFieldsEnhanced = '1';
}

async function enhanceBatteryAssignModal() {
  const headings = [...document.querySelectorAll('h3')].filter(visible);
  const heading = headings.find(h => h.textContent.trim().startsWith('Assign '));
  if (!heading) return;
  const assetName = heading.textContent.trim().replace(/^Assign\s+/, '');
  const asset = assetCache.find(a => a.name === assetName || `${a.assetTag}` === assetName);
  if (!asset || asset.type !== 'UPS Battery') return;

  const select = [...document.querySelectorAll('select')].find(s => visible(s) && [...s.options].some(o => o.textContent.includes('Select an employee')));
  if (!select) return;
  if (select.dataset.upsBatteryEnhanced === '1') return;

  try {
    upsOptionsCache = await getJson('/assets/ups-options');
  } catch (_) {
    upsOptionsCache = [];
  }

  select.innerHTML = '<option value="">Select a UPS…</option>';
  upsOptionsCache.forEach(ups => {
    const option = document.createElement('option');
    option.value = ups.id;
    option.textContent = ups.display;
    select.appendChild(option);
  });
  const label = select.closest('label')?.querySelector('span');
  if (label) label.textContent = 'Assign to UPS';
  select.dataset.upsBatteryEnhanced = '1';
  select.dataset.upsBatteryAssetId = String(asset.id);

  const button = [...document.querySelectorAll('button')].find(b => visible(b) && /Assign Asset/.test(b.textContent));
  if (button) button.textContent = 'Assign UPS Battery';

  const note = document.createElement('p');
  note.className = 'text-[10px] text-muted mt-1';
  note.textContent = 'The battery follows the selected UPS and its assigned employee.';
  select.parentNode.appendChild(note);
}

function enhanceAssetTable() {
  const table = [...document.querySelectorAll('table')].find(t => [...t.querySelectorAll('th')].some(th => th.textContent.trim() === 'Assigned To'));
  if (!table) return;
  const headers = [...table.querySelectorAll('thead th')];
  const assignedTh = headers.find(th => th.textContent.trim() === 'Assigned To');
  if (!assignedTh) return;
  if (!headers.some(th => th.textContent.trim() === 'Purchase Date')) {
    const th = document.createElement('th');
    th.className = 'py-2 pr-3';
    th.textContent = 'Purchase Date';
    assignedTh.parentNode.insertBefore(th, assignedTh);
  }
  if (!headers.some(th => th.textContent.trim() === 'Cost')) {
    const th = document.createElement('th');
    th.className = 'py-2 pr-3';
    th.textContent = 'Cost';
    assignedTh.parentNode.insertBefore(th, assignedTh);
  }

  const rows = [...table.querySelectorAll('tbody tr')].filter(tr => tr.children.length > 1);
  rows.forEach(row => {
    const tagCell = row.children[1];
    const tag = tagCell?.textContent?.trim();
    const asset = assetCache.find(a => a.assetTag === tag);
    if (!asset) return;
    const cells = [...row.children];
    if (row.dataset.assetMetaEnhanced !== '1') {
      const dateTd = document.createElement('td');
      dateTd.className = 'py-2.5 pr-3';
      dateTd.textContent = asset.purchaseDate || '—';
      row.insertBefore(dateTd, row.children[row.children.length - 2]);

      const costTd = document.createElement('td');
      costTd.className = 'py-2.5 pr-3';
      costTd.textContent = asset.cost === null || asset.cost === undefined || asset.cost === '' ? '—' : Number(asset.cost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      row.insertBefore(costTd, row.children[row.children.length - 2]);
      row.dataset.assetMetaEnhanced = '1';
    }

    const assignedCell = [...row.children].find(td => td.textContent.trim() === `${asset.assignedCount || 0} employees` || td.textContent.trim() === (asset.currentAssignment?.employeeName || ''));
    if (assignedCell && (asset.assignedCount || 0) > 1) {
      assignedCell.title = asset.assignees.map(a => `${a.employeeName}${a.upsAssetId ? ` — UPS ${assetCache.find(u => u.id === a.upsAssetId)?.serialNumber || assetCache.find(u => u.id === a.upsAssetId)?.assetTag || a.upsAssetId}` : ''}`).join('\n');
      assignedCell.style.cursor = 'help';
    }
  });
}

function enhanceAssetDetail() {
  const headings = [...document.querySelectorAll('h3')].filter(visible);
  const heading = headings.find(h => assetCache.some(a => a.name === h.textContent.trim()));
  if (!heading || heading.parentElement.dataset.assetDetailEnhanced === '1') return;
  const asset = assetCache.find(a => a.name === heading.textContent.trim());
  if (!asset) return;
  const body = heading.parentElement.parentElement;
  const grids = [...body.querySelectorAll('div')].filter(d => d.className.includes('grid grid-cols-2 gap-2 text-xs'));
  const grid = grids[0];
  if (!grid) return;

  const purchased = [...grid.children].find(c => c.textContent.includes('Purchased:'));
  if (purchased) {
    const cost = document.createElement('div');
    cost.innerHTML = `<span class="text-muted">Cost:</span> ${asset.cost === null || asset.cost === undefined || asset.cost === '' ? '—' : Number(asset.cost).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    grid.appendChild(cost);
  }

  if ((asset.assignedCount || 0) > 0) {
    const section = document.createElement('div');
    section.className = 'mt-3 pt-3 border-t border-[var(--border)]';
    section.innerHTML = '<div class="text-[10px] font-bold text-muted uppercase tracking-wider mb-2">Current Assignments</div>';
    const list = document.createElement('div');
    list.className = 'flex flex-col gap-1.5';
    asset.assignees.forEach(a => {
      const item = document.createElement('div');
      item.className = 'text-xs flex items-center justify-between';
      const ups = a.upsAssetId ? assetCache.find(u => u.id === a.upsAssetId) : null;
      item.innerHTML = `<span>${a.employeeName}</span><span class="text-muted">${ups ? `UPS ${ups.serialNumber || ups.assetTag}` : a.assignedDate}</span>`;
      list.appendChild(item);
    });
    section.appendChild(list);
    grid.parentNode.insertBefore(section, grid.nextSibling);
  }
  heading.parentElement.dataset.assetDetailEnhanced = '1';
}

function installFetchEnhancements() {
  if (window.__remoteOpsEnhancerInstalled) return;
  window.__remoteOpsEnhancerInstalled = true;
  const original = window.fetch.bind(window);
  window.__remoteOpsOriginalFetch = original;

  window.fetch = async (input, init = {}) => {
    let url = typeof input === 'string' ? input : input?.url || '';
    let method = (init.method || (typeof input !== 'string' ? input.method : 'GET') || 'GET').toUpperCase();

    if (url.includes('/assets/') && /\/assign$/.test(url) && method === 'POST') {
      const batterySelect = document.querySelector('select[data-ups-battery-enhanced="1"]');
      if (batterySelect && batterySelect.dataset.upsBatteryAssetId) {
        const body = JSON.stringify({ upsAssetId: Number(batterySelect.value) });
        return original(url.replace(/\/assign$/, '/assign-battery'), { ...init, body });
      }
    }

    if (url.includes('/assets') && (method === 'POST' || method === 'PUT')) {
      try {
        const raw = init.body;
        if (typeof raw === 'string') {
          const body = JSON.parse(raw);
          const form = activeAssetForm();
          const costEl = form?.querySelector('[data-asset-cost]');
          const quantityEl = form?.querySelector('[data-asset-quantity]');
          if (costEl) body.cost = costEl.value === '' ? null : Number(costEl.value);
          if (quantityEl) body.quantity = quantityEl.value === '' ? null : Number(quantityEl.value);
          init = { ...init, body: JSON.stringify(body) };
        }
      } catch (_) {}
    }

    const res = await original(input, init);
    if (url.includes('/assets') && method === 'GET') {
      try {
        const clone = res.clone();
        const data = await clone.json();
        if (Array.isArray(data)) assetCache = data;
      } catch (_) {}
    }
    if (url.includes('/assets/') && (method === 'POST' || method === 'PUT')) {
      setTimeout(() => getJson('/assets').then(data => { assetCache = data; }), 150);
    }
    return res;
  };
}

function runEnhancements() {
  addTypeOptions();
  addAssetCostAndQuantity();
  enhanceBatteryAssignModal();
  enhanceAssetTable();
  enhanceAssetDetail();
}

installFetchEnhancements();

const observer = new MutationObserver(() => runEnhancements());
observer.observe(document.documentElement, { childList: true, subtree: true });
setTimeout(runEnhancements, 300);
