const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const SysTrayModule = require('systray2');
const SysTray = SysTrayModule.default || SysTrayModule;

// Real 16x16 Windows ICO payload. The previous value was PNG data saved as
// .ico, which can result in a blank tray icon on Windows.
const ICON_BASE64 = 'AAABAAEAEBAAAAEAIABoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAADrYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/8pZs//fBqf/1spP/9bOU/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/7ntH//3u6P/sai7/62Ml/+54Q//rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/ufUn/9ryi//rYyf/xlGn/62Ml//fBqf/0q4r/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/vf0v/86N//+tkJ//98uz/7XI6/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml//rczf/wi13/+tjI/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/9KyM/+12QP/2uZ3/+tjJ//a2mP/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml//ray//wi13/8ZFm//a8of/uekX/+Mmz/+xsMv/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/ym3P/9KyL/+xsMv/74NT/62Ml//a5nf/0rIz/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml//CIWP/xkWX//Ong//OkgP/5z7z/74VV/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+xsMf/sbTP/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

function ensureTrayIcon() {
  const dir = path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'RemoteOpsAgent'
  );
  const iconPath = path.join(dir, 'remote-ops.ico');
  fs.mkdirSync(dir, { recursive: true });

  // Rewrite it each startup so an older invalid icon is automatically replaced.
  fs.writeFileSync(iconPath, Buffer.from(ICON_BASE64, 'base64'));
  return iconPath;
}

function promptAdminCodeInteractive() {
  const script = `
Add-Type -AssemblyName Microsoft.VisualBasic
$value = [Microsoft.VisualBasic.Interaction]::InputBox('Enter the Remote Ops administrator code to quit the monitoring agent.', 'Remote Ops Administrator', '')
Write-Output $value
`;

  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-Command',
      script,
    ],
    {
      // Keep the PowerShell console hidden while allowing the InputBox to appear.
      windowsHide: true,
      encoding: 'utf8',
    }
  );

  if (result.error || result.status !== 0) return null;

  const value = String(result.stdout || '').trim();
  return value || null;
}

function startTray({ employeeName, deviceToken, client, onQuit } = {}) {
  if (process.platform !== 'win32') {
    return {
      ready: Promise.resolve(),
      setStatus() {},
      kill() {},
    };
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

  const itemQuit = {
    title: 'Quit (Admin)',
    tooltip: 'Requires the Remote Ops administrator code',
    enabled: true,
    click: async () => {
      try {
        if (!client || !deviceToken) {
          console.error('Admin quit is unavailable because device authorization is not initialized.');
          return;
        }

        const code = promptAdminCodeInteractive();
        if (!code) return;

        await client.authorizeQuit(deviceToken, code);
        onQuit?.();
        systray.kill(false);
        process.exit(0);
      } catch (err) {
        // Failed authorization must never stop the monitoring agent.
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
    if (action?.item?.click) {
      Promise.resolve(action.item.click()).catch(err => {
        console.error(`Tray action failed: ${err.message}`);
      });
    }
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
    try {
      systray.kill(false);
    } catch (_) {
      // Tray may already be closed.
    }
  }

  return { ready, setStatus: updateStatus, kill };
}

module.exports = { startTray };
