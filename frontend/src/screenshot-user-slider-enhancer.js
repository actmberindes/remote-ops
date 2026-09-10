/* Keeps screenshot tile sizing functional and labels captures with the
   current Windows/domain user reported by the managed device. */

const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.1.2:4000/api';
const SIZE_KEY = 'remoteops_screenshot_tile_size';
const REFRESH_MS = 10000;
const MIN_SIZE = 180;
const MAX_SIZE = 520;
const DEFAULT_SIZE = 220;
let timer = null;
let requestInFlight = false;

function getHeaders() {
  const token = localStorage.getItem('rw_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function getJson(path) {
  const response = await fetch(`${API_URL}${path}`, { headers: getHeaders() });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
}

function safeSize(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return DEFAULT_SIZE;
  return Math.min(MAX_SIZE, Math.max(MIN_SIZE, Math.round(numeric / 10) * 10));
}

function textOf(el) {
  return (el?.textContent || '').replace(/\s+/g, ' ').trim();
}

function screenshotCards() {
  return [...document.querySelectorAll('.card')].filter(card => {
    const content = textOf(card);
    return /Recent Screenshots|Latest scheduled captures|Latest captures from your team|Screenshots/i.test(content)
      && card.querySelector('img');
  });
}

function screenshotGrid(card) {
  return [...card.querySelectorAll('.grid')]
    .filter(grid => grid.querySelector('img'))
    .sort((a, b) => b.querySelectorAll('img').length - a.querySelectorAll('img').length)[0] || null;
}

function applyGridSize(card, value) {
  const size = safeSize(value);
  const grid = screenshotGrid(card);
  if (grid) {
    grid.style.setProperty('grid-template-columns', `repeat(auto-fill,minmax(${size}px,1fr))`, 'important');
    grid.dataset.remoteopsScreenshotGrid = 'true';
  }

  card.querySelectorAll('input[type="range"]').forEach(input => {
    if (/Screenshot tile size/i.test(input.getAttribute('aria-label') || '') || input.closest('[data-remoteops-screenshot-size-control]')) {
      if (document.activeElement !== input) input.value = String(size);
    }
  });
}

function ensureSlider(card) {
  const input = [...card.querySelectorAll('input[type="range"]')].find(candidate => {
    return /Screenshot tile size/i.test(candidate.getAttribute('aria-label') || '')
      || candidate.closest('[data-remoteops-screenshot-size-control]');
  });
  if (!input || input.dataset.remoteopsSliderBound === 'true') return;

  input.dataset.remoteopsSliderBound = 'true';
  input.addEventListener('input', event => {
    const size = safeSize(event.target.value);
    localStorage.setItem(SIZE_KEY, String(size));
    applyGridSize(card, size);
  });
  input.addEventListener('change', event => {
    const size = safeSize(event.target.value);
    localStorage.setItem(SIZE_KEY, String(size));
    applyGridSize(card, size);
  });

  applyGridSize(card, safeSize(localStorage.getItem(SIZE_KEY)));
}

function normalizePath(value) {
  if (!value) return '';
  try {
    const url = new URL(value, window.location.origin);
    return url.pathname.replace(/\\/g, '/');
  } catch (_) {
    return String(value).split('?')[0].replace(/\\/g, '/');
  }
}

function captionNodeForImage(img) {
  const button = img.closest('button');
  if (!button) return null;
  return button.children.length > 1 ? button.children[1] : null;
}

function updateScreenshotLabels(cards, screenshots, devices) {
  const screenshotByUrl = new Map(
    (Array.isArray(screenshots) ? screenshots : []).map(item => [normalizePath(item.url), item])
  );
  const deviceById = new Map(
    (Array.isArray(devices) ? devices : []).map(device => [String(device.id), device])
  );

  for (const card of cards) {
    for (const img of card.querySelectorAll('img')) {
      const screenshot = screenshotByUrl.get(normalizePath(img.currentSrc || img.src));
      if (!screenshot) continue;

      const device = deviceById.get(String(screenshot.deviceId));
      const currentUser = device?.currentDomainUser || device?.domainUser || '';
      const time = screenshot.capturedAt ? new Date(screenshot.capturedAt).toLocaleTimeString() : '';
      const label = currentUser || screenshot.employeeName || 'Unknown user';
      const caption = captionNodeForImage(img);
      if (caption) caption.textContent = time ? `${label} · ${time}` : label;
      img.alt = `${label}${time ? ` — ${time}` : ''}`;
    }
  }
}

async function refresh() {
  if (requestInFlight) return;
  const cards = screenshotCards();
  if (cards.length === 0) return;

  requestInFlight = true;
  try {
    cards.forEach(ensureSlider);
    const [screenshots, devices] = await Promise.all([
      getJson('/activity/screenshots?limit=200'),
      getJson('/agent/devices'),
    ]);
    updateScreenshotLabels(cards, screenshots, devices);
    cards.forEach(card => applyGridSize(card, safeSize(localStorage.getItem(SIZE_KEY))));
  } catch (_) {
    // The main application remains functional if this UI-only enhancement cannot refresh.
  } finally {
    requestInFlight = false;
  }
}

function start() {
  refresh();
  if (timer) clearInterval(timer);
  timer = setInterval(refresh, REFRESH_MS);

  const observer = new MutationObserver(() => {
    screenshotCards().forEach(card => {
      ensureSlider(card);
      applyGridSize(card, safeSize(localStorage.getItem(SIZE_KEY)));
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}

export {};
