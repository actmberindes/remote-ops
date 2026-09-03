/* Live View enhancement: keep idle managed devices visible with their latest frame. */

const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.1.2:4000/api';
const REFRESH_MS = 5000;
let timer = null;
let requestId = 0;

function textOf(el) {
  return (el?.textContent || '').replace(/\s+/g, ' ').trim();
}

function headers() {
  const token = localStorage.getItem('rw_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function getJson(path) {
  const res = await fetch(`${API_URL}${path}`, { headers: headers() });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return res.json();
}

function findLiveViewCard() {
  return [...document.querySelectorAll('.card')].find(card => {
    const content = textOf(card);
    return content.includes('Live Desktop View') && content.includes('Employees currently in an active work session');
  }) || null;
}

function resolveUploadUrl(url) {
  if (!url) return null;
  return `${API_URL.replace(/\/api\/?$/, '')}${url}`;
}

function idleTileHtml(device, frame) {
  const employeeName = device.employeeName || `Employee #${device.employeeId}`;
  const department = device.employeeDepartment || '';
  const imageUrl = frame?.url ? resolveUploadUrl(frame.url) : null;
  const capturedAt = frame?.capturedAt ? new Date(frame.capturedAt) : null;
  const updated = capturedAt && !Number.isNaN(capturedAt.getTime()) ? capturedAt.toLocaleTimeString() : 'No frame available';
  const userLabel = device.domainUser || 'User session detected';
  const image = imageUrl
    ? `<img src="${imageUrl}" alt="${employeeName}" class="w-full h-full object-cover" />`
    : `<div class="flex flex-col items-center gap-1.5 text-muted"><span style="font-size:22px">▣</span><span class="text-[10px] font-medium">No recent frame</span></div>`;

  return `<div class="live-idle-tile rounded-xl overflow-hidden border border-[var(--border)]" data-idle-employee="${device.employeeId}" data-idle-device="${device.id}">
    <div class="aspect-video flex items-center justify-center relative" style="background:var(--bg)">
      ${image}
      <span class="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-bold" style="background:rgba(0,0,0,.72);color:#fff">
        <span style="width:6px;height:6px;border-radius:50%;background:var(--warning);display:inline-block"></span> IDLE
      </span>
    </div>
    <div class="p-2.5">
      <div class="text-xs font-semibold truncate">${employeeName}</div>
      <div class="text-[10px] text-muted truncate">${department}${department && userLabel ? ' · ' : ''}${userLabel}</div>
      <div class="text-[9px] text-muted mt-1">Idle · Last frame ${updated}</div>
    </div>
  </div>`;
}

function renderIdleTiles(card, devices, history) {
  const idleDevices = devices.filter(d => d.status === 'idle' && d.enrolled !== false && !d.revoked && d.employeeId != null);
  let host = card.querySelector('.live-idle-devices');

  if (idleDevices.length === 0) {
    host?.remove();
    return;
  }

  const latestByDevice = new Map();
  history.forEach(frame => {
    const existing = latestByDevice.get(Number(frame.deviceId));
    if (!existing || new Date(frame.capturedAt || 0).getTime() > new Date(existing.capturedAt || 0).getTime()) {
      latestByDevice.set(Number(frame.deviceId), frame);
    }
  });

  if (!host) {
    host = document.createElement('div');
    host.className = 'live-idle-devices mt-5 pt-4 border-t border-[var(--border)]';
    card.appendChild(host);
  }

  host.innerHTML = `
    <div class="flex items-center justify-between mb-3">
      <div>
        <div class="font-display font-bold text-sm flex items-center gap-2"><span style="width:7px;height:7px;border-radius:50%;background:var(--warning);display:inline-block"></span>Idle Devices</div>
        <div class="text-[10px] text-muted mt-0.5">Still visible using the most recent desktop frame.</div>
      </div>
      <span class="text-[10px] font-bold" style="color:var(--warning)">${idleDevices.length} Idle</span>
    </div>
    <div class="grid gap-4 grid-cols-3">
      ${idleDevices.map(device => idleTileHtml(device, latestByDevice.get(Number(device.id)))).join('')}
    </div>
  `;
}

async function refresh() {
  const card = findLiveViewCard();
  if (!card) return;
  const id = ++requestId;
  try {
    const [devices, history] = await Promise.all([
      getJson('/agent/devices'),
      getJson('/activity/live-history?limit=500'),
    ]);
    if (id !== requestId) return;
    renderIdleTiles(card, devices, history);
  } catch (_) {
    // Keep the normal Live View working even if the idle enhancement has a transient error.
  }
}

function syncHeaderCount(card) {
  const badge = [...card.querySelectorAll('span')].find(span => /^\d+ Active$/.test(textOf(span)));
  if (!badge) return;
  const idleCount = card.querySelectorAll('.live-idle-tile').length;
  const activeCount = Number((textOf(badge).match(/\d+/) || ['0'])[0]);
  badge.textContent = `${activeCount} Active${idleCount ? ` · ${idleCount} Idle` : ''}`;
}

function tick() {
  refresh().then(() => {
    const card = findLiveViewCard();
    if (card) syncHeaderCount(card);
  });
}

function start() {
  if (timer) return;
  tick();
  timer = setInterval(tick, REFRESH_MS);
}

const observer = new MutationObserver(() => {
  const card = findLiveViewCard();
  if (card) start();
});

observer.observe(document.body, { subtree: true, childList: true, characterData: true });
start();
