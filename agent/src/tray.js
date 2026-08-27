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
  if (!fs.existsSync(iconPath)) fs.writeFileSync(iconPath, Buffer.from(ICON_BASE64, 'base64'));
  return iconPath;
}

function promptAdminCode() {
  const script = `
Add-Type -AssemblyName Microsoft.VisualBasic
$value = [Microsoft.VisualBasic.Interaction]::InputBox('Enter the Remote Ops administrator code to quit the monitoring agent.', 'Remote Ops Administrator', '')
if ([string]::IsNullOrWhiteSpace($value)) { exit 2 }
[Environment]::SetEnvironmentVariable('REMOTE_OPS_QUIT_CODE_RESULT', $value, 'Process')
exit 0
`;

  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ], {
    windowsHide: true,
    encoding: 'utf8',
    env: process.env,
  });

  if (result.status !== 0) return null;
  return String(result.stdout || '').trim() || null;
}

// Use a temporary PowerShell process to collect the code without exposing a
// visible console window. The caller supplies the resulting code to the server.
function promptAdminCodeInteractive() {
  const script = `
Add-Type -AssemblyName Microsoft.VisualBasic
$value = [Microsoft.VisualBasic.Interaction]::InputBox('Enter the Remote Ops administrator code to quit the monitoring agent.', 'Remote Ops Administrator', '')
Write-Output $value
`;
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    script,
  ], {
    windowsHide: true,
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  const value = String(result.stdout || '').trim();
  return value || null;
}

function startTray({ employeeName, deviceToken, client, onQuit } = {}) {
  if (process.platform !== 'win32') return { ready: Promise.resolve(), setStatus() {}, kill() {} };

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

  const itemQuit = {
    title: 'Quit (Admin)',
    tooltip: 'Requires the Remote Ops administrator code',
    enabled: true,
    click: async () => {
      try {
        const code = promptAdminCodeInteractive();
        if (!code) return;
        if (!client || !deviceToken) return;
        await client.authorizeQuit(deviceToken, code);
        onQuit?.();
        systray.kill(false);
        process.exit(0);
      } catch (err) {
        // Keep the monitoring agent running on failed authorization.
        console.error(`Admin quit authorization failed: ${err.message}`);
      }
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
