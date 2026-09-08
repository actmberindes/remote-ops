/* Adds a live "Idle for …" duration to the Dashboard's Live Status Roster. */
const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.1.2:4000/api';
const REFRESH_MS = 5000;
const STYLE_ID = 'remoteops-idle-duration-style';

let requestInFlight = false;
let timer = null;

function headers() {
  const token = localStorage.getItem('rw_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function formatIdleDuration(startedAt) {
  const start = new Date(startedAt).getTime();
  if (Number.isNaN(start)) return '';
  const seconds = Math.max(0, Math.floor((Date.now() - start) / 1000));
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  if (hours > 0) {
    const hourText = `${hours} hr${hours === 1 ? '' : 's'}`;
    return minutes > 0 ? `Idle for ${hourText} ${minutes} min` : `Idle for ${hourText}`;
  }
  return `Idle for ${Math.max(1, minutes)} min`;
}

function rosterCard() {
  return [...document.querySelectorAll('.card')].find(card =>
    /Live Status Roster/i.test(card.textContent || '')
  ) || null;
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .remoteops-idle-duration{margin-top:2px;font-size:9px;font-weight:700;color:var(--warning);line-height:1.2}
  `;
  document.head.appendChild(style);
}

function apply(users) {
  const card = rosterCard();
  if (!card) return;
  const byName = new Map((Array.isArray(users) ? users : []).map(u => [String(u.name || '').trim(), u]));

  const rows = [...card.querySelectorAll('div')].filter(node => {
    const name = node.querySelector('.text-xs.font-semibold')?.textContent?.trim();
    return Boolean(name && byName.has(name));
  });

  for (const row of rows) {
    const name = row.querySelector('.text-xs.font-semibold')?.textContent?.trim();
    const user = byName.get(name);
    if (!user) continue;

    let target = row.querySelector('.remoteops-idle-duration');
    if (user.status === 'idle' && user.statusSince) {
      if (!target) {
        target = document.createElement('div');
        target.className = 'remoteops-idle-duration';
        const nameNode = row.querySelector('.text-xs.font-semibold');
        nameNode?.parentElement?.appendChild(target);
      }
      target.textContent = formatIdleDuration(user.statusSince);
      target.title = `Idle since ${new Date(user.statusSince).toLocaleString()}`;
    } else {
      target?.remove();
    }
  }
}

async function refresh() {
  if (requestInFlight) return;
  if (!rosterCard()) return;
  requestInFlight = true;
  try {
    const response = await fetch(`${API_URL}/users`, { headers: headers() });
    if (!response.ok) return;
    apply(await response.json());
  } catch (_) {
    // Keep the last visible duration during transient network errors.
  } finally {
    requestInFlight = false;
  }
}

function start() {
  injectStyles();
  refresh();
  clearInterval(timer);
  timer = setInterval(refresh, REFRESH_MS);
  const observer = new MutationObserver(() => {
    if (rosterCard()) apply([]);
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
else start();

export {};
