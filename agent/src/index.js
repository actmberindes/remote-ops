const { loadConfig, isEnrolled } = require('./config.js');
const { createClient } = require('./api.js');
const { runPairingFlow } = require('./pairing.js');
const { startScheduler } = require('./scheduler.js');
const { startTray } = require('./tray.js');
const capture = require('./capture.js');

if (process.platform === 'win32') {
  try {
    const ConsoleWindow = require('node-hide-console-window');
    ConsoleWindow.hideConsole();
  } catch (_) {
    // Console hiding is optional; continue if the native module is unavailable.
  }
}

function log(message) {
  console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
}

async function main() {
  let config = loadConfig();

  // Enrollment is Admin-controlled. There is no employee Start/Stop or
  // blocking first-run consent step in the agent startup flow.
  if (!isEnrolled(config)) {
    log('No enrolled device found — starting Admin enrollment flow.');
    config = await runPairingFlow({ log });
  }

  const client = createClient(config.apiUrl);
  log(`Remote Ops Agent running for assigned employee ${config.employeeName || 'Unknown'}.`);

  let scheduler = null;
  const tray = startTray({
    employeeName: config.employeeName,
    onQuit: () => {
      scheduler?.stop();
      log('Agent quit from system tray by administrator.');
    },
  });

  scheduler = startScheduler({
    client,
    config,
    capture,
    log,
    onDeviceStateChange: state => tray.setStatus(state),
  });

  await tray.ready.catch(err => log(`Tray startup failed: ${err.message}`));
  tray.setStatus('offline');

  process.on('SIGINT', () => {
    scheduler.stop();
    tray.kill();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    scheduler.stop();
    tray.kill();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Fatal agent error:', err);
  process.exit(1);
});
