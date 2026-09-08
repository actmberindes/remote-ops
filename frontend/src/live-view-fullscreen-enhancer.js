/* Makes Live View frames clickable and opens the selected display in a full-screen viewer. */
const STYLE_ID = 'remoteops-live-fullscreen-style';
const OVERLAY_ID = 'remoteops-live-fullscreen-overlay';

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .remoteops-display-image{cursor:zoom-in;transition:filter .15s ease,transform .15s ease}
    .remoteops-display-image:hover{filter:brightness(1.04)}
    .remoteops-live-fullscreen-overlay{position:fixed;inset:0;z-index:9999;display:flex;flex-direction:column;background:rgba(4,7,12,.94);backdrop-filter:blur(5px)}
    .remoteops-live-fullscreen-toolbar{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:12px 16px;border-bottom:1px solid rgba(255,255,255,.12);color:#fff;flex-shrink:0}
    .remoteops-live-fullscreen-title{min-width:0;font-size:13px;font-weight:800;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    .remoteops-live-fullscreen-meta{margin-top:2px;font-size:10px;color:rgba(255,255,255,.65);font-weight:600}
    .remoteops-live-fullscreen-badges{display:flex;align-items:center;gap:6px;flex-shrink:0}
    .remoteops-live-fullscreen-badge{padding:4px 8px;border-radius:999px;background:rgba(255,255,255,.12);font-size:9px;font-weight:900;letter-spacing:.08em}
    .remoteops-live-fullscreen-close{border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.08);color:#fff;border-radius:8px;padding:7px 10px;cursor:pointer;font-weight:800}
    .remoteops-live-fullscreen-close:hover{background:rgba(255,255,255,.16)}
    .remoteops-live-fullscreen-body{min-height:0;flex:1;display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto}
    .remoteops-live-fullscreen-body img{display:block;max-width:100%;max-height:100%;object-fit:contain;box-shadow:0 12px 40px rgba(0,0,0,.5);background:#000}
  `;
  document.head.appendChild(style);
}

function closeViewer() {
  document.getElementById(OVERLAY_ID)?.remove();
  document.body.style.overflow = '';
}

function openViewer(img) {
  closeViewer();
  const tile = img.closest('.remoteops-live-employee-tile');
  const employee = tile?.querySelector('.remoteops-live-employee-name')?.textContent?.trim() || 'Live View';
  const device = tile?.querySelector('.remoteops-live-employee-device')?.textContent?.trim() || '';
  const display = img.closest('.remoteops-display-frame')?.querySelector('.remoteops-display-name')?.textContent?.trim() || 'Display';
  const updated = img.closest('.remoteops-display-frame')?.querySelector('.remoteops-display-updated')?.textContent?.trim() || '';
  const isRdp = /RDP/i.test(tile?.textContent || '');
  const src = img.currentSrc || img.src;

  const overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;
  overlay.className = 'remoteops-live-fullscreen-overlay';
  overlay.innerHTML = `
    <div class="remoteops-live-fullscreen-toolbar">
      <div style="min-width:0">
        <div class="remoteops-live-fullscreen-title">${escapeHtml(employee)} — ${escapeHtml(display)}</div>
        <div class="remoteops-live-fullscreen-meta">${escapeHtml(device)}${updated ? ` · ${escapeHtml(updated)}` : ''}</div>
      </div>
      <div class="remoteops-live-fullscreen-badges">
        ${isRdp ? '<span class="remoteops-live-fullscreen-badge">RDP</span>' : ''}
        <button type="button" class="remoteops-live-fullscreen-close" aria-label="Close full view">Close</button>
      </div>
    </div>
    <div class="remoteops-live-fullscreen-body">
      <img src="${escapeHtml(src)}" alt="${escapeHtml(employee)} — ${escapeHtml(display)}" />
    </div>
  `;

  overlay.querySelector('.remoteops-live-fullscreen-close')?.addEventListener('click', closeViewer);
  overlay.addEventListener('click', event => {
    if (event.target === overlay) closeViewer();
  });
  document.addEventListener('keydown', handleEscape, { once: true });
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';
}

function handleEscape(event) {
  if (event.key === 'Escape') closeViewer();
}

function wire() {
  injectStyles();
  if (document.documentElement.dataset.remoteopsLiveFullscreenWired === 'true') return;
  document.documentElement.dataset.remoteopsLiveFullscreenWired = 'true';
  document.addEventListener('click', event => {
    const img = event.target.closest?.('.remoteops-display-image');
    if (!img) return;
    event.preventDefault();
    openViewer(img);
  });
}

wire();
export {};
