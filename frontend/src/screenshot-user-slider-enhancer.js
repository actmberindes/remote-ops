/* Keeps the screenshot tile-size slider functional and persistent. */

const SIZE_KEY = 'remoteops_screenshot_tile_size';
const MIN_SIZE = 180;
const MAX_SIZE = 520;
const DEFAULT_SIZE = 220;

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

function start() {
  const apply = () => {
    screenshotCards().forEach(card => {
      ensureSlider(card);
      applyGridSize(
        card,
        safeSize(localStorage.getItem(SIZE_KEY))
      );
    });
  };

  apply();

  const observer = new MutationObserver(() => {
    apply();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}

export {};
