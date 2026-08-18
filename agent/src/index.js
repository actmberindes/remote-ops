const { loadConfig, isPaired } = require('./config.js');
const { runConsentFlow } = require('./consent.js');
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
    // Continue normally if the optional console-hiding native module is unavailable.
  }
}

function log(message) {
  console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
}

async function main() {
  let config = loadConfig();

  // First run must be explicitly acknowledged before pairing or monitoring can begin.
  config = await runConsentFlow({ log });

  if (!isPaired(config)) {
    log('No paired device found — starting pairing flow.');
    config = await runPairingFlow({ log });
  }

  const client = createClient(config.apiUrl);
  log(`Remote Ops Agent running for ${config.employeeName}.`);

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
    onSessionStateChange: active => tray.setStatus(active),
  });

  await tray.ready.catch(err => log(`Tray startup failed: ${err.message}`));
  tray.setStatus(false);

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
