import { pageFromUrl, domainFromUrl, todayStr, bufferToEntries, computeTransition } from './logic.js';

const IDLE_THRESHOLD_SECONDS = 300;
const FLUSH_PERIOD_MINUTES = 1;
const HEARTBEAT_PERIOD_MINUTES = 0.5;
const DEFAULT_API_URL = 'http://192.168.1.2:4000/api';

async function getApiUrl() {
  const { apiUrl } = await chrome.storage.local.get('apiUrl');
  if (apiUrl && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/api\/?$/i.test(apiUrl)) {
    return apiUrl;
  }

  await chrome.storage.local.set({ apiUrl: DEFAULT_API_URL });
  return DEFAULT_API_URL;
}

async function getTrackingState() {
  const { current, buffer } = await chrome.storage.local.get(['current', 'buffer']);
  return { current: current || null, buffer: buffer || {} };
}

async function setTrackingState(partial) {
  await chrome.storage.local.set(partial);
}

async function getObservedPage() {
  try {
    let idleState = 'active';
    try { idleState = await chrome.idle.queryState(IDLE_THRESHOLD_SECONDS); } catch (e) { /* idle API not available */ }
    if (idleState !== 'active') return null;

    const win = await chrome.windows.getLastFocused({});
    if (!win || win.focused === false) return null;

    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
    return tab ? pageFromUrl(tab.url) : null;
  } catch (e) {
    return null;
  }
}

async function getDeviceState() {
  try {
    const idleState = await chrome.idle.queryState(IDLE_THRESHOLD_SECONDS);
    return idleState === 'active' ? 'active' : 'idle';
  } catch (e) {
    return 'active';
  }
}

async function ensureMachineId() {
  const { machineId } = await chrome.storage.local.get('machineId');
  if (machineId) return machineId;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ machineId: id });
  return id;
}

async function sendHeartbeat() {
  const { deviceToken } = await chrome.storage.local.get('deviceToken');
  if (!deviceToken) return;

  try {
    const apiUrl = await getApiUrl();
    const machineId = await ensureMachineId();
    const state = await getDeviceState();
    const platform = navigator.platform || 'Browser';
    const browserName = /Edg/i.test(navigator.userAgent) ? 'Edge' : 'Chrome';

    await fetch(`${apiUrl}/agent/heartbeat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${deviceToken}`,
      },
      body: JSON.stringify({
        state,
        machineId,
        hostname: `${browserName} — ${platform}`,
        domain: null,
        domainUser: null,
        agentVersion: chrome.runtime.getManifest().version,
      }),
    });
  } catch (e) {
    // Backend will determine Offline when heartbeats stop arriving.
  }
}

async function refreshTracking() {
  const observedPage = await getObservedPage();
  const { current, buffer } = await getTrackingState();
  const result = computeTransition({ current, buffer, observedPage });
  if (result.changed) {
    await setTrackingState({ buffer: result.buffer, current: result.current });
  }
}

async function flush() {
  await refreshTrackingForceClose();

  const { buffer } = await getTrackingState();
  const entries = bufferToEntries(buffer);
  if (entries.length === 0) return;

  const { deviceToken } = await chrome.storage.local.get('deviceToken');
  if (!deviceToken) return;

  try {
    const apiUrl = await getApiUrl();
    const res = await fetch(`${apiUrl}/activity/web-usage`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${deviceToken}`,
      },
      body: JSON.stringify({ entries }),
    });

    if (res.ok) await setTrackingState({ buffer: [] });
  } catch (e) {
    // Offline or backend down — keep the buffer for retry.
  }

  await refreshTracking();
}

async function refreshTrackingForceClose() {
  const { current, buffer } = await getTrackingState();
  const result = computeTransition({ current, buffer, observedPage: null });
  await setTrackingState({ buffer: result.buffer, current: null });
}

chrome.tabs.onActivated.addListener(() => refreshTracking());
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (tab.active && changeInfo.url) refreshTracking();
});
chrome.windows.onFocusChanged.addListener(() => refreshTracking());
chrome.idle.onStateChanged.addListener(() => {
  refreshTracking();
  sendHeartbeat();
});
chrome.idle.setDetectionInterval(IDLE_THRESHOLD_SECONDS);

chrome.alarms.create('flush', { periodInMinutes: FLUSH_PERIOD_MINUTES });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'flush') flush();
});

chrome.alarms.create('heartbeat', { periodInMinutes: HEARTBEAT_PERIOD_MINUTES });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'heartbeat') sendHeartbeat();
});

chrome.runtime.onStartup.addListener(() => {
  refreshTracking();
  sendHeartbeat();
});
chrome.runtime.onInstalled.addListener(() => {
  refreshTracking();
  sendHeartbeat();
});
