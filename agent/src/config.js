const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

// Windows: C:\Users\<user>\AppData\Roaming\RemoteOpsAgent\config.json
// (falls back sensibly on other OSes for local dev/testing on this machine)
function configDir() {
  const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(base, 'RemoteOpsAgent');
}

const CONFIG_PATH = path.join(configDir(), 'config.json');

const defaults = {
  apiUrl: process.env.REMOTE_OPS_API_URL || 'http://localhost:4000/api',
  deviceToken: null,
  deviceId: null,
  employeeId: null,
  employeeName: null,
  pairedAt: null,
  consentAcceptedAt: null,
};

function loadConfig() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return { ...defaults, ...JSON.parse(raw) };
  } catch (e) {
    return { ...defaults };
  }
}

function saveConfig(partial) {
  const current = loadConfig();
  const next = { ...current, ...partial };
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function isPaired(config) {
  return !!(config && config.deviceToken);
}

function hasConsent(config) {
  return !!(config && config.consentAcceptedAt);
}

module.exports = { loadConfig, saveConfig, isPaired, hasConsent, CONFIG_PATH };
