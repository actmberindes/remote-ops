import { domainFromUrl, todayStr, bufferToEntries, computeTransition } from './logic.js';

const IDLE_THRESHOLD_SECONDS = 60;
const FLUSH_PERIOD_MINUTES = 1;

async function getApiUrl() {
  const { apiUrl } = await chrome.storage.local.get('apiUrl');
  return apiUrl || 'http://localhost:4000/api';
}

// MV3 service workers can be killed and restarted at any time between events,
// so `current`/`buffer` live in chrome.storage.local (not a plain JS variable)
// to survive that — otherwise every worker restart would silently drop data.
async function getTrackingState() {
  const { current, buffer } = await chrome.storage.local.get(['current', 'buffer']);
  return { current: current || null, buffer: buffer || {} };
}

async function setTrackingState(partial) {
  await chrome.storage.local.set(partial);
}

async function getObservedDomain() {
  try {
    let idleState = 'active';
    try { idleState = await chrome.idle.queryState(IDLE_THRESHOLD_SECONDS); } catch (e) { /* idle API not available in some contexts */ }
    if (idleState !== 'active') return null;

    const win = await chrome.windows.getLastFocused({});
    if (!win || win.focused === false) return null;

    const [tab] = await chrome.tabs.query({ active: true, windowId: win.id });
    return tab ? domainFromUrl(tab.url) : null;
  } catch (e) {
    return null; // transient errors shouldn't crash tracking; just skip this tick
  }
}

async function refreshTracking() {
  const observedDomain = await getObservedDomain();
  const { current, buffer } = await getTrackingState();
  const result = computeTransition({ current, buffer, observedDomain });
  if (result.changed) {
    await setTrackingState({ buffer: result.buffer, current: result.current });
  }
}

async function flush() {
  // Close out whatever segment is currently open so its elapsed time is included.
  await refreshTrackingForceClose();

  const { buffer } = await getTrackingState();
  const entries = bufferToEntries(buffer);
  if (entries.length === 0) return;

  const { deviceToken } = await chrome.storage.local.get('deviceToken');
  if (!deviceToken) return; // not paired yet — keep buffering until it is

  try {
    const apiUrl = await getApiUrl();
    const res = await fetch(`${apiUrl}/activity/web-usage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${deviceToken}` },
      body: JSON.stringify({ entries }),
    });
    if (res.ok) await setTrackingState({ buffer: {} });
    // on failure, leave the buffer intact so the next flush retries with everything
  } catch (e) { /* offline or backend down — retry next interval */ }

  await refreshTracking(); // resume tracking a fresh segment
}

async function refreshTrackingForceClose() {
  const { current, buffer } = await getTrackingState();
  const result = computeTransition({ current, buffer, observedDomain: null });
  await setTrackingState({ buffer: result.buffer, current: null });
}

chrome.tabs.onActivated.addListener(() => refreshTracking());
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => { if (tab.active && changeInfo.url) refreshTracking(); });
chrome.windows.onFocusChanged.addListener(() => refreshTracking());
chrome.idle.onStateChanged.addListener(() => refreshTracking());
chrome.idle.setDetectionInterval(IDLE_THRESHOLD_SECONDS);

chrome.alarms.create('flush', { periodInMinutes: FLUSH_PERIOD_MINUTES });
chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === 'flush') flush(); });

chrome.runtime.onStartup.addListener(() => refreshTracking());
chrome.runtime.onInstalled.addListener(() => refreshTracking());
