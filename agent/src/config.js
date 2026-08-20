const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

function configDir() {
  const base = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(base, 'RemoteOpsAgent');
}

const CONFIG_PATH = path.join(configDir(), 'config.json');
const DEFAULT_API_URL = process.env.REMOTE_OPS_API_URL || 'http://192.168.1.2:4000/api';

const defaults = {
  apiUrl: DEFAULT_API_URL,
  deviceToken: null,
  deviceId: null,
  employeeId: null,
  employeeName: null,
  deviceName: null,
  enrolledAt: null,
  machineId: null,
  hostname: null,
  domain: null,
  domainUser: null,
  agentVersion: '2.0.0',
  consentAcceptedAt: null,
};

function loadConfig() {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    const merged = { ...defaults, ...raw };

    if (!merged.apiUrl || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/api\/?$/i.test(merged.apiUrl)) {
      merged.apiUrl = DEFAULT_API_URL;
    }

    return merged;
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

function isEnrolled(config) {
  return !!(config && config.deviceToken && config.deviceId && config.employeeId);
}

function hasConsent(config) {
  return !!(config && config.consentAcceptedAt);
}

module.exports = { loadConfig, saveConfig, isEnrolled, isPaired: isEnrolled, hasConsent, CONFIG_PATH };
