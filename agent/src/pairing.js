const readline = require('node:readline');
const { loadConfig, saveConfig, isEnrolled } = require('./config.js');
const { createClient } = require('./api.js');
const { getDeviceState } = require('./telemetry.js');

function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, answer => { rl.close(); resolve(answer.trim()); }));
}

async function runPairingFlow({ log = console.log } = {}) {
  const config = loadConfig();
  if (isEnrolled(config)) {
    log(`Already enrolled as ${config.employeeName} on ${config.deviceName || config.hostname || config.deviceId}.`);
    return config;
  }

  log('');
  log('=========================================');
  log('  Remote Ops Agent — Device Enrollment');
  log('=========================================');
  log('This computer is being enrolled by IT for managed monitoring.');
  log('The Admin must register this computer first and provide an enrollment code.');
  log('');

  const client = createClient(config.apiUrl);
  const code = await ask('Enrollment code: ');
  const telemetry = getDeviceState();

  try {
    const result = await client.enroll(code, {
      machineId: telemetry.machineId,
      hostname: telemetry.hostname,
      domain: telemetry.domain,
      domainUser: telemetry.domainUser,
      deviceType: 'desktop-agent',
      agentVersion: config.agentVersion,
    });

    const saved = saveConfig({
      deviceToken: result.deviceToken,
      deviceId: result.deviceId,
      employeeId: result.employeeId,
      employeeName: result.employeeName,
      deviceName: telemetry.hostname,
      enrolledAt: new Date().toISOString(),
      machineId: telemetry.machineId,
      hostname: telemetry.hostname,
      domain: telemetry.domain,
      domainUser: telemetry.domainUser,
    });

    log('');
    log(`✔ Enrolled successfully to ${result.employeeName}.`);
    log('The agent will now monitor the registered device automatically while it is online.');
    return saved;
  } catch (e) {
    log(`✘ Enrollment failed: ${e.message}`);
    process.exitCode = 1;
    throw e;
  }
}

module.exports = { runPairingFlow };

if (require.main === module) {
  runPairingFlow().catch(() => process.exit(1));
}
