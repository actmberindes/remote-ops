const readline = require('node:readline');
const os = require('node:os');
const { loadConfig, saveConfig, isPaired } = require('./config.js');
const { createClient } = require('./api.js');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer.trim()); }));
}

async function runPairingFlow({ log = console.log } = {}) {
  const config = loadConfig();
  if (isPaired(config)) {
    log(`Already paired to ${config.employeeName} (device #${config.deviceId}). Delete the config file to re-pair.`);
    return config;
  }

  log('');
  log('=========================================');
  log('  Remote Ops Agent — Device Setup');
  log('=========================================');
  log('This computer will be monitored during active work sessions:');
  log('  - Periodic desktop screenshots (interval set by your Admin)');
  log('  - Near-live desktop preview while a session is Active');
  log('  - Web browsing activity, if the companion browser extension is installed');
  log('');
  log('To link this computer to your account:');
  log('  1. Sign in to the employee portal');
  log('  2. Go to Dashboard -> "Pair This Device" and generate a code');
  log('  3. Enter that code below (valid for 10 minutes)');
  log('');

  const client = createClient(config.apiUrl);
  const code = await ask('Pairing code: ');
  const deviceName = `${os.hostname()} (${os.platform()})`;

  try {
    const result = await client.pair(code, deviceName, 'desktop-agent');
    const saved = saveConfig({
      deviceToken: result.deviceToken,
      deviceId: result.deviceId,
      employeeId: result.employeeId,
      employeeName: result.employeeName,
      pairedAt: new Date().toISOString(),
    });
    log('');
    log(`✔ Paired successfully as ${result.employeeName}. Monitoring will begin the next time your session is Active.`);
    return saved;
  } catch (e) {
    log(`✘ Pairing failed: ${e.message}`);
    process.exitCode = 1;
    throw e;
  }
}

module.exports = { runPairingFlow };

// Allow running directly: `npm run pair`
if (require.main === module) {
  runPairingFlow().catch(() => process.exit(1));
}
