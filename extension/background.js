import { pageFromUrl, domainFromUrl, todayStr, bufferToEntries, computeTransition } from './logic.js';

const IDLE_THRESHOLD_SECONDS = 60;
const FLUSH_PERIOD_MINUTES = 1;
const SESSION_POLL_PERIOD_MINUTES = 0.25; // 15 seconds
const DEFAULT_API_URL = 'http://192.168.1.2:4000/api';

async function getApiUrl() {
  const { apiUrl } = await chrome.storage.local.get('apiUrl');
  if (apiUrl && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/api\/?$/i.test(apiUrl)) {
    return apiUrl;
  }

  await chrome.storage.local.set({ apiUrl: DEFAULT_API_URL });
  return DEFAULT_API_URL;
}

// MV3 service workers can be killed and restarted at any time,
// so current/buffer/sessionActive live in chrome.storage.local.
async function getTrackingState() {
  const { current, buffer, sessionActive } = await chrome.storage.local.get(['current', 'buffer', 'sessionActive']);
  return { current: current || null, buffer: buffer || {}, sessionActive: sessionActive === true };
}

async function setTrackingState(partial) {
  await chrome.storage.local.set(partial);
}

async function getSessionActive() {
  const { sessionActive } = await getTrackingState();
  return sessionActive;
}

async function refreshSessionState() {
  const { deviceToken } = await chrome.storage.local.get('deviceToken');
  if (!deviceToken) {
    await setTrackingState({ sessionActive: false });
    return false;
  }

  try {
    const apiUrl = await getApiUrl();
    const res = await fetch(`${apiUrl}/agent/session-status`, {
      headers: { Authorization: `Bearer ${deviceToken}` },
    });
    if (!res.ok) throw new Error(`Session status request failed (${res.status})`);

    const data = await res.json();
    const active = data.status === 'active';
    const previous = await getSessionActive();

    if (!active && previous) {
      await refreshTrackingForceClose();
    }

    await setTrackingState({ sessionActive: active });
    return active;
  } catch (e) {
    // Keep the last known state during a temporary network outage. The backend
    // independently rejects monitoring uploads while the employee is inactive.
    return getSessionActive();
  }
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

async function refreshTracking() {
  const active = await refreshSessionState();
  if (!active) return;

  const observedPage = await getObservedPage();
  const { current, buffer } = await getTrackingState();
  const result = computeTransition({ current, buffer, observedPage });
  if (result.changed) {
    await setTrackingState({ buffer: result.buffer, current: result.current });
  }
}

async function flush() {
  const active = await refreshSessionState();

  // Close out whatever page segment is currently open so its elapsed time is included.
  await refreshTrackingForceClose();

  const { buffer } = await getTrackingState();
  const entries = bufferToEntries(buffer);
  if (entries.length === 0) return;

  const { deviceToken } = await chrome.storage.local.get('deviceToken');
  if (!deviceToken) return;

  // Keep buffered activity locally while inactive. It was collected during an
  // active session and will be uploaded once the session becomes active again.
  if (!active) return;

  try {
    const apiUrl = await getApiUrl();
    const res = await fetch(`${apiUrl}/activity/web-usage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deviceToken}` },
      body: JSON.stringify({ entries }),
    });
    if (res.ok) await setTrackingState({ buffer: [] });
  } catch (e) { /* offline or backend down — keep the buffer for retry */ }

  await refreshTracking();
}

async function refreshTrackingForceClose() {
  const { current, buffer } = await getTrackingState();
  const result = computeTransition({ current, buffer, observedPage: null });
  await setTrackingState({ buffer: result.buffer, current: null });
}

chrome.tabs.onActivated.addListener(() => refreshTracking());
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => { if (tab.active && changeInfo.url) refreshTracking(); });
chrome.windows.onFocusChanged.addListener(() => refreshTracking());
chrome.idle.onStateChanged.addListener(() => refreshTracking());
chrome.idle.setDetectionInterval(IDLE_THRESHOLD_SECONDS);

chrome.alarms.create('flush', { periodInMinutes: FLUSH_PERIOD_MINUTES });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'flush') flush();
});

chrome.alarms.create('session-status', { periodInMinutes: SESSION_POLL_PERIOD_MINUTES });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'session-status') refreshSessionState();
});

chrome.runtime.onStartup.addListener(() => refreshTracking());
chrome.runtime.onInstalled.addListener(() => refreshTracking());
