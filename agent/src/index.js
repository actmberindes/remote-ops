const { loadConfig, isPaired } = require('./config.js');
const { createClient } = require('./api.js');
const { runPairingFlow } = require('./pairing.js');
const { startScheduler } = require('./scheduler.js');
const capture = require('./capture.js');

function log(message) {
  console.log(`[${new Date().toLocaleTimeString()}] ${message}`);
}

async function main() {
  let config = loadConfig();

  if (!isPaired(config)) {
    log('No paired device found — starting pairing flow.');
    config = await runPairingFlow({ log });
  }

  const client = createClient(config.apiUrl);
  log(`Remote Ops Agent running for ${config.employeeName}.`);

  const scheduler = startScheduler({ client, config, capture, log });

  process.on('SIGINT', () => { scheduler.stop(); process.exit(0); });
  process.on('SIGTERM', () => { scheduler.stop(); process.exit(0); });
}

main().catch(err => {
  console.error('Fatal agent error:', err);
  process.exit(1);
});
