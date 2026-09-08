import crypto from 'node:crypto';

// Live View keeps only the newest frame for each device/display. This avoids
// returning a backlog of stale frames when the agent uploads faster than the
// browser refreshes the monitoring page.
const LIVE_FRAME_TTL_MS = 30 * 1000;
const frames = new Map();
const latestByDisplay = new Map();

function keyOf(token) {
  return String(token || '').trim();
}

function displayKeyOf(deviceId, employeeId, displayId, displayIndex) {
  const device = String(deviceId ?? '');
  const employee = String(employeeId ?? '');
  const display = String(displayId ?? displayIndex ?? 1);
  return `${device}:${employee}:${display}`;
}

function removeToken(token) {
  const key = keyOf(token);
  if (!key) return;
  const frame = frames.get(key);
  if (!frame) return;
  frames.delete(key);
  const displayKey = frame.displayKey;
  if (displayKey && latestByDisplay.get(displayKey) === key) {
    latestByDisplay.delete(displayKey);
  }
}

function cleanupExpired() {
  const now = Date.now();
  for (const [token, frame] of frames) {
    if (frame.expiresAt <= now) removeToken(token);
  }
}

export function putLiveFrame({ deviceId, employeeId, displayId, displayName, displayIndex, buffer, mimeType = 'image/png' }) {
  cleanupExpired();

  const normalizedDisplayId = displayId ? String(displayId) : null;
  const normalizedDisplayIndex = Number(displayIndex) || 1;
  const displayKey = displayKeyOf(deviceId, employeeId, normalizedDisplayId, normalizedDisplayIndex);
  const previousToken = latestByDisplay.get(displayKey);
  if (previousToken) removeToken(previousToken);

  const token = crypto.randomBytes(24).toString('hex');
  frames.set(token, {
    token,
    deviceId,
    employeeId,
    displayId: normalizedDisplayId,
    displayName: displayName ? String(displayName) : null,
    displayIndex: normalizedDisplayIndex,
    displayKey,
    mimeType,
    buffer,
    capturedAt: new Date().toISOString(),
    expiresAt: Date.now() + LIVE_FRAME_TTL_MS,
  });
  latestByDisplay.set(displayKey, token);
  return token;
}

export function getLiveFrame(token) {
  cleanupExpired();
  const key = keyOf(token);
  const frame = frames.get(key);
  if (!frame) return null;
  if (frame.expiresAt <= Date.now()) {
    removeToken(key);
    return null;
  }
  return frame;
}

export function getLiveFramesForDevice(deviceId, employeeId = null) {
  cleanupExpired();
  const matches = [...frames.values()].filter(frame => {
    if (frame.deviceId !== deviceId) return false;
    if (employeeId !== null && frame.employeeId !== employeeId) return false;
    return true;
  });
  return matches.sort((a, b) => {
    const ai = Number(a.displayIndex) || 1;
    const bi = Number(b.displayIndex) || 1;
    return ai - bi;
  });
}

export function clearLiveFramesForDevice(deviceId) {
  for (const [token, frame] of frames) {
    if (frame.deviceId === deviceId) removeToken(token);
  }
}

setInterval(cleanupExpired, 5000).unref();
