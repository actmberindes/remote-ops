const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const SysTrayModule = require('systray2');
const SysTray = SysTrayModule.default || SysTrayModule;

const ICON_BASE64 = 'AAABAAEAEBAAAAAAIAB6AAAAFgAAAIlQTkcNChoKAAAADUlIRIAAAAQAAAAEAgGAAAAH/P/YQAAAEFJREFUeJxjtG769p+BAsBEiWaqGMCCzDlSy0mUJpvm7zRyATYbkAE2Fw58IA4DA7DGArHpgfouwBX/NHUBxQYAAHcIC9qF63yCAAAAAElFTkSuQmCC';

function ensureTrayIcon() {
  const dir = path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'RemoteOpsAgent');
  const iconPath = path.join(dir, 'remote-ops.ico');
  fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(iconPath)) {
    fs.writeFileSync(iconPath, Buffer.from(ICON_BASE64, 'base64'));
  }
  return iconPath;
}

function promptAdminCode() {
  const expected = process.env.REMOTE_OPS_AGENT_ADMIN_CODE;
  if (!expected) return false;

  const script = `
Add-Type -AssemblyName Microsoft.VisualBasic
$value = [Microsoft.VisualBasic.Interaction]::InputBox('Enter the Remote Ops administrator code to quit the monitoring agent.', 'Remote Ops Administrator', '')
if ($value -eq '${String(expected).replace(/'/g, "''")}') { exit 0 }
exit 1
`;

  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ], {
    windowsHide: true,
    encoding: 'utf8',
  });

  return result.status === 0;
}

function startTray({ employeeName, onQuit } = {}) {
  if (process.platform !== 'win32') {
    return { ready: Promise.resolve(), setStatus() {}, kill() {} };
  }

  const itemEmployee = {
    title: `Assigned: ${employeeName || 'Unassigned'}`,
    tooltip: 'Managed employee assignment',
    enabled: false,
  };

  const itemStatus = {
    title: 'Device Offline',
    tooltip: 'Remote Ops device heartbeat state',
    enabled: false,
  };

  const hasAdminCode = !!process.env.REMOTE_OPS_AGENT_ADMIN_CODE;
  const itemQuit = {
    title: 'Quit (Admin)',
    tooltip: hasAdminCode ? 'Requires the administrator code' : 'Administrator quit code is not configured',
    enabled: hasAdminCode,
    click: () => {
      if (!promptAdminCode()) return;
      onQuit?.();
      systray.kill(false);
      process.exit(0);
    },
  };

  const systray = new SysTray({
    menu: {
      icon: ensureTrayIcon(),
      title: 'Remote Ops',
      tooltip: 'Remote Ops Device Agent',
      items: [itemEmployee, itemStatus, SysTray.separator, itemQuit],
    },
    debug: false,
    copyDir: true,
  });

  systray.onClick(action => {
    if (action.item && action.item.click) action.item.click();
  });

  const ready = systray.ready();

  function updateStatus(state) {
    const labels = {
      active: 'Device Active',
      idle: 'Device Idle',
      'logged-out': 'No User Logged In',
      offline: 'Device Offline',
    };

    itemStatus.title = labels[state] || 'Device Offline';
    itemStatus.tooltip = `Remote Ops device state: ${labels[state] || state}`;
    systray.sendAction({ type: 'update-item', item: itemStatus });
  }

  function kill() {
    try { systray.kill(false); } catch (_) { /* tray may already be closed */ }
  }

  return { ready, setStatus: updateStatus, kill };
}

module.exports = { startTray };
