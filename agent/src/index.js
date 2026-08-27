const { loadConfig, isEnrolled } = require('./config.js');
const { createClient } = require('./api.js');
const { runPairingFlow } = require('./pairing.js');
const { startScheduler } = require('./scheduler.js');
const { startTray } = require('./tray.js');
const capture = require('./capture.js');

const enrollMode = process.argv.slice(2).includes('--enroll');

function log(message) {
  console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
}

async function main() {
  let config = loadConfig();

  if (enrollMode) {
    if (isEnrolled(config)) {
      log(`Already enrolled as ${config.employeeName || 'Unknown'} on ${config.deviceName || config.hostname || config.deviceId}.`);
      return;
    }

    log('Starting Remote Ops device enrollment...');
    await runPairingFlow({ log });
    return;
  }

  if (!isEnrolled(config)) {
    log('No enrolled device found. Run this agent with --enroll to register it first.');
    return;
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

  try {
    await tray.ready;
    tray.setStatus('offline');
  } catch (err) {
    log(`Tray startup failed: ${err.message}`);
  }

  scheduler = startScheduler({
    client,
    config,
    capture,
    log,
    onDeviceStateChange: state => tray.setStatus(state),
  });

  process.on('SIGINT', () => {
    scheduler?.stop();
    tray.kill();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    scheduler?.stop();
    tray.kill();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('Fatal agent error:', err);
  process.exit(1);
});
