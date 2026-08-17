const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const screenshot = require('screenshot-desktop');

const tmpDir = () => {
  const dir = path.join(os.tmpdir(), 'remote-ops-agent');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

// Full-quality capture for the scheduled screenshot log.
async function captureFull() {
  const filePath = path.join(tmpDir(), `full-${Date.now()}.png`);
  await screenshot({ filename: filePath });
  return filePath;
}

// Lower-cost capture used for the frequent near-live frame refresh. screenshot-desktop
// doesn't support downscaling itself, so full-res is captured and the UI/backend treat
// it as a thumbnail; swapping in a resize step (e.g. via `sharp`) is a natural follow-up
// if bandwidth becomes a concern at scale.
async function captureLive() {
  const filePath = path.join(tmpDir(), `live-${Date.now()}.png`);
  await screenshot({ filename: filePath });
  return filePath;
}

function cleanup(filePath) {
  fs.unlink(filePath, () => { /* best-effort */ });
}

module.exports = { captureFull, captureLive, cleanup };
