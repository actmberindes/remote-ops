import crypto from 'node:crypto';

// Live View frames are intentionally memory-only. A frame is kept just long
// enough for the monitoring page to request it, then naturally expires.
const LIVE_FRAME_TTL_MS = 12 * 1000;
const frames = new Map();

function keyOf(token) {
  return String(token || '').trim();
}

function cleanupExpired() {
  const now = Date.now();
  for (const [token, frame] of frames) {
    if (frame.expiresAt <= now) frames.delete(token);
  }
}

export function putLiveFrame({ deviceId, employeeId, displayId, displayName, displayIndex, buffer, mimeType = 'image/png' }) {
  cleanupExpired();
  const token = crypto.randomBytes(24).toString('hex');
  frames.set(token, {
    token,
    deviceId,
    employeeId,
    displayId: displayId ? String(displayId) : null,
    displayName: displayName ? String(displayName) : null,
    displayIndex: Number(displayIndex) || 1,
    mimeType,
    buffer,
    capturedAt: new Date().toISOString(),
    expiresAt: Date.now() + LIVE_FRAME_TTL_MS,
  });
  return token;
}

export function getLiveFrame(token) {
  cleanupExpired();
  const frame = frames.get(keyOf(token));
  if (!frame) return null;
  if (frame.expiresAt <= Date.now()) {
    frames.delete(keyOf(token));
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
    if (frame.deviceId === deviceId) frames.delete(token);
  }
}

setInterval(cleanupExpired, LIVE_FRAME_TTL_MS).unref();
