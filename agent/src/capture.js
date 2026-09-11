const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const screenshot = require('screenshot-desktop');

const tmpDir = () => {
  const dir = path.join(os.tmpdir(), 'remote-ops-agent');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

async function listDisplays() {
  const displays = await screenshot.listDisplays();
  return Array.isArray(displays) && displays.length > 0
    ? displays
    : [{ id: 0, name: 'Display 1' }];
}

async function captureAll(prefix) {
  const displays = await listDisplays();
  const captures = [];

  for (let index = 0; index < displays.length; index += 1) {
    const display = displays[index];
    const displayIndex = index + 1;
    const safeId = String(display.id ?? displayIndex).replace(/[^a-zA-Z0-9_-]/g, '_');
    const filePath = path.join(tmpDir(), `${prefix}-${Date.now()}-display-${displayIndex}-${safeId}.png`);

    await screenshot({
      filename: filePath,
      format: 'png',
      screen: display.id,
    });

    captures.push({
      filePath,
      displayId: String(display.id ?? displayIndex),
      // Use the stable display index for the visible label. Do not expose the
      // Windows device path (for example \\.\DISPLAY1) to the UI.
      displayName: `Display ${displayIndex}`,
      displayIndex,
    });
  }

  return captures;
}

async function captureFullAll() {
  return captureAll('full');
}

async function captureLiveAll() {
  return captureAll('live');
}

async function captureFull() {
  const captures = await captureFullAll();
  return captures[0]?.filePath;
}

async function captureLive() {
  const captures = await captureLiveAll();
  return captures[0]?.filePath;
}

function cleanup(filePath) {
  if (!filePath) return;
  fs.unlink(filePath, () => { /* best-effort */ });
}

module.exports = { listDisplays, captureFullAll, captureLiveAll, captureFull, captureLive, cleanup };
