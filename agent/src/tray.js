const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const SysTrayModule = require('systray2');
const SysTray = SysTrayModule.default || SysTrayModule;

// Real 16x16 Windows ICO payload.
const ICON_BASE64 = 'AAABAAEAEBAAAAEAIABoBAAAFgAAACgAAAAQAAAAIAAAAAEAIAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAAAADrYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/8pZs//fBqf/1spP/9bOU/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/7ntH//3u6P/sai7/62Ml/+54Q//rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/ufUn/9ryi//rYyf/xlGn/62Ml//fBqf/0q4r/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/vf0v/86N//+tkJ//98uz/7XI6/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml//rczf/wi13/+tjI/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/9KyM/+12QP/2uZ3/+tjJ//a2mP/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml//ray//wi13/8ZFm//a8of/uekX/+Mmz/+xsMv/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/ym3P/9KyL/+xsMv/74NT/62Ml//a5nf/0rIz/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml//CIWP/xkWX//Ong//OkgP/5z7z/74VV/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+xsMf/sbTP/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/62Ml/+tjJf/rYyX/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA==';

function ensureTrayIcon() {
  const dir = path.join(
    process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'),
    'RemoteOpsAgent'
  );
  const iconPath = path.join(dir, 'remote-ops.ico');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(iconPath, Buffer.from(ICON_BASE64, 'base64'));
  return iconPath;
}

function promptAdminCodeInteractive() {
  return new Promise(resolve => {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      'Add-Type -AssemblyName System.Drawing',
      '[System.Windows.Forms.Application]::EnableVisualStyles()',
      '$form = New-Object System.Windows.Forms.Form',
      "$form.Text = 'Remote Ops Administrator'",
      '$form.StartPosition = "CenterScreen"',
      '$form.Size = New-Object System.Drawing.Size(430,190)',
      '$form.FormBorderStyle = "FixedDialog"',
      '$form.MaximizeBox = $false',
      '$form.MinimizeBox = $false',
      '$form.TopMost = $true',
      '$label = New-Object System.Windows.Forms.Label',
      "$label.Text = 'Enter the administrator code to quit the Remote Ops monitoring agent.'",
      '$label.AutoSize = $false',
      '$label.Location = New-Object System.Drawing.Point(20,20)',
      '$label.Size = New-Object System.Drawing.Size(370,38)',
      '$form.Controls.Add($label)',
      '$input = New-Object System.Windows.Forms.TextBox',
      '$input.Location = New-Object System.Drawing.Point(20,65)',
      '$input.Size = New-Object System.Drawing.Size(370,24)',
      '$input.UseSystemPasswordChar = $true',
      '$form.Controls.Add($input)',
      '$ok = New-Object System.Windows.Forms.Button',
      "$ok.Text = 'Authorize & Quit'",
      '$ok.Location = New-Object System.Drawing.Point(214,105)',
      '$ok.Size = New-Object System.Drawing.Size(176,30)',
      '$ok.DialogResult = [System.Windows.Forms.DialogResult]::OK',
      '$form.Controls.Add($ok)',
      '$cancel = New-Object System.Windows.Forms.Button',
      "$cancel.Text = 'Cancel'",
      '$cancel.Location = New-Object System.Drawing.Point(20,105)',
      '$cancel.Size = New-Object System.Drawing.Size(100,30)',
      '$cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel',
      '$form.Controls.Add($cancel)',
      '$form.AcceptButton = $ok',
      '$form.CancelButton = $cancel',
      '$input.Select()',
      '$result = $form.ShowDialog()',
      'if ($result -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Write($input.Text) }'
    ].join('; ');

    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-STA', '-WindowStyle', 'Hidden', '-ExecutionPolicy', 'Bypass', '-Command', script],
      {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'ignore'],
      }
    );

    let stdout = '';
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.on('error', () => resolve(null));
    child.on('close', code => {
      const value = stdout.trim();
      resolve(code === 0 && value ? value : null);
    });
  });
}

function startTray({ employeeName, deviceToken, client, onQuit } = {}) {
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

  const itemQuit = {
    title: 'Quit (Admin)',
    tooltip: 'Requires the Remote Ops administrator code',
    enabled: true,
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

  let quitting = false;

  systray.onClick(action => {
    if (quitting || action?.item !== itemQuit) return;
    quitting = true;

    (async () => {
      try {
        if (!client || !deviceToken) throw new Error('Admin quit is unavailable because device authorization is not initialized.');

        const code = await promptAdminCodeInteractive();
        if (!code) {
          quitting = false;
          return;
        }

        await client.authorizeQuit(deviceToken, code);
        onQuit?.();
        await systray.kill(false);
        process.exit(0);
      } catch (err) {
        quitting = false;
        console.error(`Admin quit authorization failed: ${err.message}`);
      }
    })().catch(err => {
      quitting = false;
      console.error(`Tray quit action failed: ${err.message}`);
    });
  });

  const ready = systray.ready();

  function updateStatus(state) {
    const labels = {
      active: 'Device Active',
      idle: 'Device Idle',
      'logged-out': 'No User Logged In',
      offline: 'Device Offline',
      revoked: 'Device Revoked',
      pending: 'Enrollment Pending',
    };
    const label = labels[state] || 'Device Offline';
    itemStatus.title = label;
    itemStatus.tooltip = `Remote Ops device state: ${label}`;
    systray.sendAction({ type: 'update-item', item: itemStatus });
  }

  async function kill() {
    try {
      await systray.kill(false);
    } catch (_) {
      // Tray may already be closed.
    }
  }

  return { ready, setStatus: updateStatus, kill };
}

module.exports = { startTray };
