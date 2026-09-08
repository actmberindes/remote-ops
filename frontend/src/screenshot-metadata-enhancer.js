/* Replaces the legacy screenshot "Device Registered To" label with
   Current User + Display + Date metadata for each screenshot tile. */
const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.1.2:4000/api';
const REFRESH_MS = 5000;
const STYLE_ID = 'remoteops-screenshot-metadata-style';
let cache = new Map();
let requestInFlight = false;

function headers() {
  const token = localStorage.getItem('rw_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function normalizePath(url) {
  try { return decodeURIComponent(new URL(url, window.location.origin).pathname); }
  catch (_) { return String(url || ''); }
}

function formatDate(value) {
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function findCard() {
  return [...document.querySelectorAll('.card')].find(card => {
    const text = card.textContent || '';
    return /Recent Screenshots|Scheduled desktop captures|Screenshots/i.test(text) && card.querySelector('img');
  }) || null;
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .remoteops-screenshot-meta{display:flex;align-items:center;gap:5px;margin-top:5px;color:var(--text-muted);font-size:9px;font-weight:700;line-height:1.25;white-space:normal}
    .remoteops-screenshot-meta strong{color:var(--text);font-weight:800}
  `;
  document.head.appendChild(style);
}

async function loadMetadata() {
  if (requestInFlight) return;
  requestInFlight = true;
  try {
    const card = findCard();
    const date = card?.querySelector('input[type="date"]')?.value;
    const params = new URLSearchParams({ limit: '200' });
    if (date) params.set('date', date);
    const response = await fetch(`${API_URL}/activity/screenshots?${params.toString()}`, { headers: headers() });
    if (!response.ok) return;
    const data = await response.json();
    const next = new Map();
    for (const item of Array.isArray(data) ? data : []) {
      next.set(normalizePath(item.url), item);
    }
    cache = next;
    applyMetadata();
  } catch (_) {
    // Keep the last successful metadata cache.
  } finally {
    requestInFlight = false;
  }
}

function findLegacyLabel(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
  let node;
  while ((node = walker.nextNode())) {
    const text = (node.textContent || '').trim();
    if (/^Device Registered To:?$/i.test(text)) return node;
  }
  return null;
}

function applyMetadata() {
  const card = findCard();
  if (!card) return;

  card.querySelectorAll('[data-remoteops-screenshot-tile]').forEach(tile => {
    const img = tile.querySelector('img');
    const item = cache.get(normalizePath(img?.src || ''));
    const meta = tile.querySelector('[data-remoteops-screenshot-meta]');
    if (!item) {
      meta?.remove();
      return;
    }
    const currentUser = item.currentUser || item.employeeName || 'Unknown User';
    const display = item.display || item.displayName || `Display ${item.displayIndex || 1}`;
    const label = `${currentUser} · ${display} · ${formatDate(item.capturedAt)}`;
    if (meta) {
      meta.textContent = label;
    } else {
      const wrapper = document.createElement('div');
      wrapper.className = 'remoteops-screenshot-meta';
      wrapper.dataset.remoteopsScreenshotMeta = 'true';
      wrapper.textContent = label;
      const host = tile.querySelector('figcaption') || tile.querySelector('.caption') || img?.parentElement;
      host?.parentElement?.appendChild(wrapper);
    }
  });

  // Works with the current React ScreenshotEvidence tile structure without
  // depending on a specific Tailwind utility class hierarchy.
  card.querySelectorAll('img').forEach(img => {
    let tile = img.parentElement;
    for (let i = 0; i < 7 && tile && tile !== card; i += 1) {
      if (tile.dataset.remoteopsScreenshotTile === 'true') break;
      if (findLegacyLabel(tile)) {
        tile.dataset.remoteopsScreenshotTile = 'true';
        break;
      }
      tile = tile.parentElement;
    }
  });

  card.querySelectorAll('[data-remoteops-screenshot-tile="true"]').forEach(tile => {
    const legacy = findLegacyLabel(tile);
    if (legacy) legacy.remove();
  });

  card.querySelectorAll('[data-remoteops-screenshot-tile="true"]').forEach(tile => {
    const img = tile.querySelector('img');
    const item = cache.get(normalizePath(img?.src || ''));
    if (!item) return;
    let meta = tile.querySelector('[data-remoteops-screenshot-meta]');
    if (!meta) {
      meta = document.createElement('div');
      meta.className = 'remoteops-screenshot-meta';
      meta.dataset.remoteopsScreenshotMeta = 'true';
      tile.appendChild(meta);
    }
    meta.textContent = `${item.currentUser || item.employeeName || 'Unknown User'} · ${item.display || item.displayName || `Display ${item.displayIndex || 1}`} · ${formatDate(item.capturedAt)}`;
  });
}

function start() {
  injectStyles();
  loadMetadata();
  setInterval(loadMetadata, REFRESH_MS);
  const observer = new MutationObserver(() => applyMetadata());
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();

export {};
