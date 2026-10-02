const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const screenshot = require('screenshot-desktop');

const CAPTURE_TIMEOUT_MS = 12000;

function withTimeout(promise, label) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${CAPTURE_TIMEOUT_MS}ms`)), CAPTURE_TIMEOUT_MS)
    ),
  ]);
}

async function listDisplays() {
  const displays = await withTimeout(screenshot.listDisplays(), 'Display enumeration');
  return Array.isArray(displays) && displays.length > 0
    ? displays
    : [{ id: 0, name: 'Display 1' }];
}

async function captureDisplay(display) {
  const displayId = display?.id ?? 0;
  let memoryError;

  try {
    const imageBuffer = await withTimeout(
      screenshot({ format: 'png', screen: displayId }),
      `Screen capture display ${displayId}`
    );
    if (Buffer.isBuffer(imageBuffer) && imageBuffer.length > 0) return imageBuffer;
    throw new Error('screenshot-desktop returned an empty image buffer');
  } catch (error) {
    memoryError = error;
  }

  const tempDir = path.join(os.tmpdir(), 'remote-ops-agent-capture');
  fs.mkdirSync(tempDir, { recursive: true });
  const tempPath = path.join(
    tempDir,
    `capture-${Date.now()}-${process.pid}-${Math.random().toString(16).slice(2)}.png`
  );

  try {
    await withTimeout(
      screenshot({ filename: tempPath, format: 'png', screen: displayId }),
      `File capture display ${displayId}`
    );
    const imageBuffer = fs.readFileSync(tempPath);
    if (!imageBuffer.length) throw new Error('fallback screenshot file was empty');
    return imageBuffer;
  } catch (fileError) {
    throw new Error(
      `display ${displayId}: memory capture failed (${memoryError.message}); file fallback failed (${fileError.message})`
    );
  } finally {
    try { fs.unlinkSync(tempPath); } catch (_) {}
  }
}

async function captureAll() {
  const displays = await listDisplays();
  const captures = [];

  for (let index = 0; index < displays.length; index += 1) {
    const display = displays[index];
    const displayIndex = index + 1;
    const imageBuffer = await captureDisplay(display);

    captures.push({
      imageBuffer,
      displayId: String(display.id ?? displayIndex),
      displayName: `Display ${displayIndex}`,
      displayIndex,
    });
  }

  return captures;
}

async function captureFullAll() { return captureAll(); }
async function captureLiveAll() { return captureAll(); }

async function captureFull() {
  const captures = await captureFullAll();
  return captures[0]?.imageBuffer;
}

async function captureLive() {
  const captures = await captureLiveAll();
  return captures[0]?.imageBuffer;
}

function cleanup() {}

module.exports = { listDisplays, captureFullAll, captureLiveAll, captureFull, captureLive, cleanup };
