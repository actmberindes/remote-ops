import { JSONFilePreset } from 'lowdb/node';
import bcrypt from 'bcryptjs';
import path from 'node:path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbFile = path.join(__dirname, '..', 'data', 'db.json');

const LIVE_VIEW_RETENTION_DAYS = 5 / (24 * 60); // 5 minutes

const defaultData = {
  users: [], applications: [], timeSessions: [], notifications: [],
  tickets: [], ticketMessages: [], ticketAttachments: [],
  assets: [], assetAssignments: [], assetLogs: [],
  devices: [], pairingCodes: [], deviceStateHistory: [], screenshots: [], liveFrames: [], liveFrameHistory: [], webUsageLogs: [],
  agentConfig: {
    screenshotIntervalMinutes: 10,
    liveViewFrameIntervalSeconds: 5,
    screenshotRetentionDays: 3,
    liveViewRetentionDays: LIVE_VIEW_RETENTION_DAYS,
    webUsageRetentionDays: 7,
  },
  idSeq: 1000, ticketSeq: 0, assetTagSeq: 0,
};

export const db = await JSONFilePreset(dbFile, defaultData);

for (const key of Object.keys(defaultData)) {
  if (db.data[key] === undefined) db.data[key] = defaultData[key];
}
if (!Array.isArray(db.data.deviceStateHistory)) db.data.deviceStateHistory = [];

function employeeIdForDomainUser(domainUser) {
  const normalized = String(domainUser || '').trim().toLowerCase();
  if (!normalized) return null;
  const slash = normalized.lastIndexOf('\\');
  const username = slash >= 0 ? normalized.slice(slash + 1) : normalized;
  const employee = db.data.users.find(u => u.role === 'Employee' && String(u.email || '').split('@')[0].toLowerCase() === username);
  return employee?.id || null;
}

for (const device of db.data.devices) {
  if (device.enrolled === undefined) device.enrolled = !!device.deviceToken;
  if (device.state === undefined) device.state = device.revoked ? 'revoked' : 'offline';
  if (device.lastSeenAt === undefined) device.lastSeenAt = null;
  if (device.machineId === undefined) device.machineId = null;
  if (device.hostname === undefined) device.hostname = device.deviceName || null;
  if (device.domain === undefined) device.domain = null;
  if (device.domainUser === undefined) device.domainUser = null;
  if (device.agentVersion === undefined) device.agentVersion = null;
  if (device.currentEmployeeId === undefined) device.currentEmployeeId = employeeIdForDomainUser(device.domainUser);
  if (device.currentSessionStartedAt === undefined) device.currentSessionStartedAt = null;
}
if (db.data.agentConfig && db.data.agentConfig.screenshotRetentionDays === 30 && !db.data.agentConfig.liveViewRetentionDays) db.data.agentConfig.screenshotRetentionDays = 7;
if (db.data.agentConfig && db.data.agentConfig.screenshotRetentionDays === 7) db.data.agentConfig.screenshotRetentionDays = 3;
if (db.data.agentConfig && db.data.agentConfig.screenshotRetentionDays === undefined) db.data.agentConfig.screenshotRetentionDays = 3;
if (db.data.agentConfig && (db.data.agentConfig.liveViewRetentionDays === undefined || db.data.agentConfig.liveViewRetentionDays === 3)) db.data.agentConfig.liveViewRetentionDays = LIVE_VIEW_RETENTION_DAYS;
if (db.data.agentConfig && db.data.agentConfig.webUsageRetentionDays === undefined) db.data.agentConfig.webUsageRetentionDays = 7;
await db.write();

export function nextId() {
  db.data.idSeq += 1;
  return db.data.idSeq;
}

export function nextTicketNumber() {
  db.data.ticketSeq = (db.data.ticketSeq || 0) + 1;
  return `TCK-${String(db.data.ticketSeq).padStart(4, '0')}`;
}

const ASSET_TAG_PREFIXES = {
  desktop: 'DT', laptop: 'LP', server: 'SRV', monitor: 'MON', printer: 'PRN', phone: 'PH', tablet: 'TAB',
  router: 'RTR', switch: 'SWT', firewall: 'FW', keyboard: 'KB', mouse: 'MSE', headset: 'HS', docking: 'DK', 'dock station': 'DK',
};

function assetTypePrefix(type) {
  const normalized = String(type || '').trim().toLowerCase();
  if (ASSET_TAG_PREFIXES[normalized]) return ASSET_TAG_PREFIXES[normalized];
  const compact = normalized.replace(/[^a-z0-9]/g, '');
  if (compact.includes('desktop')) return 'DT';
  if (compact.includes('laptop') || compact.includes('notebook')) return 'LP';
  if (compact.includes('server')) return 'SRV';
  if (compact.includes('monitor')) return 'MON';
  if (compact.includes('printer')) return 'PRN';
  if (compact.includes('router')) return 'RTR';
  if (compact.includes('switch')) return 'SWT';
  if (compact.includes('keyboard')) return 'KB';
  if (compact.includes('mouse')) return 'MSE';
  if (compact.includes('headset')) return 'HS';
  const letters = String(type || '').toUpperCase().replace(/[^A-Z]/g, '');
  return (letters.slice(0, 3) || 'AST');
}

export function nextAssetTag(type) {
  const prefix = assetTypePrefix(type);
  let tag;
  do {
    const suffix = String(Math.floor(Math.random() * 10000)).padStart(4, '0');
    tag = `${prefix}${suffix}`;
  } while (db.data.assets.some(a => a.assetTag === tag));
  db.data.assetTagSeq = (db.data.assetTagSeq || 0) + 1;
  return tag;
}
