const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.1.2:4000/api';

const STYLE_ID = 'remoteops-version-tracking-style';
const BADGE_ID = 'remoteops-version-badge';
const MODAL_ID = 'remoteops-version-modal';

function addStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    #${BADGE_ID} {
      position: fixed;
      left: 14px;
      bottom: 12px;
      z-index: 80;
      display: inline-flex;
      align-items: center;
      gap: 7px;
      padding: 6px 9px;
      border: 1px solid var(--border, #d7dce5);
      border-radius: 8px;
      background: var(--surface, #fff);
      color: var(--text-muted, #6b7280);
      box-shadow: 0 3px 12px rgba(0,0,0,.08);
      font-size: 10px;
      font-weight: 700;
      cursor: pointer;
      transition: transform .15s ease, box-shadow .15s ease;
    }
    #${BADGE_ID}:hover { transform: translateY(-1px); box-shadow: 0 5px 16px rgba(0,0,0,.12); }
    #${BADGE_ID} .remoteops-version-dot {
      width: 6px;
      height: 6px;
      border-radius: 999px;
      background: var(--success, #16a34a);
    }
    #${MODAL_ID} {
      position: fixed;
      inset: 0;
      z-index: 200;
      display: none;
      align-items: center;
      justify-content: center;
      padding: 20px;
      background: rgba(0,0,0,.42);
      backdrop-filter: blur(3px);
    }
    #${MODAL_ID}.open { display: flex; }
    #${MODAL_ID} .remoteops-version-dialog {
      width: min(620px, 100%);
      max-height: min(720px, 90vh);
      overflow: auto;
      padding: 22px;
      border: 1px solid var(--border, #d7dce5);
      border-radius: 14px;
      background: var(--surface, #fff);
      color: var(--text, #111827);
      box-shadow: 0 24px 70px rgba(0,0,0,.22);
    }
    #${MODAL_ID} .remoteops-version-header { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; margin-bottom:18px; }
    #${MODAL_ID} .remoteops-version-title { font-size:16px; font-weight:800; }
    #${MODAL_ID} .remoteops-version-subtitle { margin-top:4px; color:var(--text-muted,#6b7280); font-size:11px; }
    #${MODAL_ID} .remoteops-version-close { border:0; background:transparent; color:var(--text-muted,#6b7280); cursor:pointer; font-size:20px; line-height:1; padding:2px 4px; }
    #${MODAL_ID} .remoteops-version-meta { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; margin-bottom:18px; }
    #${MODAL_ID} .remoteops-version-card { padding:10px 12px; border:1px solid var(--border,#d7dce5); border-radius:9px; background:var(--bg,#f7f8fa); }
    #${MODAL_ID} .remoteops-version-label { font-size:9px; font-weight:800; text-transform:uppercase; letter-spacing:.06em; color:var(--text-muted,#6b7280); }
    #${MODAL_ID} .remoteops-version-value { margin-top:4px; font-size:12px; font-weight:700; word-break:break-word; }
    #${MODAL_ID} .remoteops-release { padding:14px 0; border-top:1px solid var(--border,#d7dce5); }
    #${MODAL_ID} .remoteops-release:first-of-type { border-top:0; }
    #${MODAL_ID} .remoteops-release-row { display:flex; justify-content:space-between; gap:12px; align-items:baseline; }
    #${MODAL_ID} .remoteops-release-version { font-size:13px; font-weight:800; }
    #${MODAL_ID} .remoteops-release-date { font-size:10px; color:var(--text-muted,#6b7280); }
    #${MODAL_ID} .remoteops-release-title { margin-top:4px; font-size:11px; font-weight:700; }
    #${MODAL_ID} ul { margin:7px 0 0 16px; padding:0; color:var(--text-muted,#6b7280); font-size:10px; line-height:1.65; }
    @media (max-width:640px) { #${MODAL_ID} .remoteops-version-meta { grid-template-columns:1fr; } }
  `;
  document.head.appendChild(style);
}

function shortCommit(value) {
  return value ? String(value).slice(0, 7) : '—';
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function ensureModal() {
  let modal = document.getElementById(MODAL_ID);
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = MODAL_ID;
  modal.innerHTML = `
    <div class="remoteops-version-dialog" role="dialog" aria-modal="true" aria-label="Remote Ops version history">
      <div class="remoteops-version-header">
        <div><div class="remoteops-version-title">Remote Ops Version History</div><div class="remoteops-version-subtitle">Release information and tracked changes</div></div>
        <button type="button" class="remoteops-version-close" aria-label="Close">×</button>
      </div>
      <div class="remoteops-version-meta"></div>
      <div class="remoteops-version-releases"></div>
    </div>`;
  modal.addEventListener('click', (event) => {
    if (event.target === modal || event.target.closest('.remoteops-version-close')) modal.classList.remove('open');
  });
  document.body.appendChild(modal);
  return modal;
}

function renderVersionInfo(info) {
  const modal = ensureModal();
  const meta = modal.querySelector('.remoteops-version-meta');
  const releases = modal.querySelector('.remoteops-version-releases');
  meta.innerHTML = `
    <div class="remoteops-version-card"><div class="remoteops-version-label">Portal version</div><div class="remoteops-version-value">v${info.version || '—'}</div></div>
    <div class="remoteops-version-card"><div class="remoteops-version-label">Windows agent</div><div class="remoteops-version-value">v${info.agentVersion || '—'}</div></div>
    <div class="remoteops-version-card"><div class="remoteops-version-label">Release date</div><div class="remoteops-version-value">${formatDate(info.releaseDate)}</div></div>
    <div class="remoteops-version-card"><div class="remoteops-version-label">Release commit</div><div class="remoteops-version-value">${shortCommit(info.releaseCommit)}</div></div>`;

  const changelog = Array.isArray(info.changelog) ? info.changelog : [];
  releases.innerHTML = changelog.length ? changelog.map((release) => `
    <div class="remoteops-release">
      <div class="remoteops-release-row"><div class="remoteops-release-version">v${release.version || '—'}</div><div class="remoteops-release-date">${formatDate(release.date)}</div></div>
      <div class="remoteops-release-title">${release.title || 'Release'}</div>
      ${Array.isArray(release.changes) && release.changes.length ? `<ul>${release.changes.map(change => `<li>${change}</li>`).join('')}</ul>` : ''}
    </div>`).join('') : '<div class="remoteops-release"><div class="remoteops-release-title">No release notes available.</div></div>';
}

async function loadVersionInfo() {
  try {
    const response = await fetch(`${API_URL}/version`, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error(`Version request failed (${response.status})`);
    return await response.json();
  } catch (_) {
    return { version: 'unknown', agentVersion: 'unknown', releaseDate: null, releaseCommit: null, changelog: [] };
  }
}

async function initVersionTracking() {
  if (!document.body || document.getElementById(BADGE_ID)) return;
  addStyles();
  const badge = document.createElement('button');
  badge.id = BADGE_ID;
  badge.type = 'button';
  badge.title = 'View Remote Ops version history';
  badge.innerHTML = '<span class="remoteops-version-dot"></span><span>Remote Ops</span><span class="remoteops-version-number">v—</span>';
  document.body.appendChild(badge);

  const info = await loadVersionInfo();
  badge.querySelector('.remoteops-version-number').textContent = `v${info.version || '—'}`;
  badge.addEventListener('click', () => {
    renderVersionInfo(info);
    ensureModal().classList.add('open');
  });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initVersionTracking, { once: true });
else initVersionTracking();
