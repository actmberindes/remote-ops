const screenshot = require('screenshot-desktop');

async function listDisplays() {
  const displays = await screenshot.listDisplays();
  return Array.isArray(displays) && displays.length > 0
    ? displays
    : [{ id: 0, name: 'Display 1' }];
}

async function captureAll() {
  const displays = await listDisplays();
  const captures = [];

  for (let index = 0; index < displays.length; index += 1) {
    const display = displays[index];
    const displayIndex = index + 1;

    // Capture into memory. screenshot-desktop cleans up its own temporary
    // capture file when no filename is supplied.
    const imageBuffer = await screenshot({
      format: 'png',
      screen: display.id,
    });

    captures.push({
      imageBuffer,
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
  return captureAll();
}

async function captureLiveAll() {
  return captureAll();
}

async function captureFull() {
  const captures = await captureFullAll();
  return captures[0]?.imageBuffer;
}

async function captureLive() {
  const captures = await captureLiveAll();
  return captures[0]?.imageBuffer;
}

function cleanup() {
  // Captures are held in memory; there is no agent-created screenshot file
  // to remove.
}

module.exports = { listDisplays, captureFullAll, captureLiveAll, captureFull, captureLive, cleanup };
