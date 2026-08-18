const { spawnSync } = require('node:child_process');
const { saveConfig } = require('./config.js');

const CONSENT_TITLE = 'Remote Ops Monitoring Consent';

function escapePowerShell(value) {
  return String(value).replace(/'/g, "''");
}

function showConsentDialog() {
  if (process.platform !== 'win32') {
    return false;
  }

  const script = `
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$form = New-Object System.Windows.Forms.Form
$form.Text = '${escapePowerShell(CONSENT_TITLE)}'
$form.StartPosition = 'CenterScreen'
$form.Size = New-Object System.Drawing.Size(650, 520)
$form.MinimumSize = New-Object System.Drawing.Size(650, 520)
$form.MaximizeBox = $false
$form.MinimizeBox = $false
$form.TopMost = $true
$form.FormBorderStyle = 'FixedDialog'

$title = New-Object System.Windows.Forms.Label
$title.Text = 'Before monitoring can begin'
$title.Font = New-Object System.Drawing.Font('Segoe UI', 16, [System.Drawing.FontStyle]::Bold)
$title.Location = New-Object System.Drawing.Point(25, 20)
$title.Size = New-Object System.Drawing.Size(590, 35)
$form.Controls.Add($title)

$intro = New-Object System.Windows.Forms.Label
$intro.Text = 'This computer is paired with Remote Ops. Monitoring is only active during an active work session started from the employee portal.'
$intro.Font = New-Object System.Drawing.Font('Segoe UI', 10)
$intro.Location = New-Object System.Drawing.Point(25, 65)
$intro.Size = New-Object System.Drawing.Size(590, 55)
$form.Controls.Add($intro)

$box = New-Object System.Windows.Forms.TextBox
$box.Multiline = $true
$box.ReadOnly = $true
$box.ScrollBars = 'Vertical'
$box.Font = New-Object System.Drawing.Font('Segoe UI', 9.5)
$box.Location = New-Object System.Drawing.Point(25, 125)
$box.Size = New-Object System.Drawing.Size(590, 255)
$box.Text = @'
Remote Ops may capture the following information while your work session is Active:

1. Periodic desktop screenshots at the interval configured by your administrator.

2. Near-live desktop frames for the Live View monitoring page, at the interval configured by your administrator.

3. Browser activity from the paired browser extension, including domain/website information and time spent, when the extension is installed and the work session is Active.

4. Monitoring history is retained according to the administrator-configured retention settings.

Monitoring does not begin until you acknowledge this notice. Stopping the work session stops new desktop and browser monitoring activity.
'@
$form.Controls.Add($box)

$ack = New-Object System.Windows.Forms.CheckBox
$ack.Text = 'I acknowledge the monitoring notice and understand what data may be captured during an Active session.'
$ack.Font = New-Object System.Drawing.Font('Segoe UI', 9.5)
$ack.Location = New-Object System.Drawing.Point(25, 395)
$ack.Size = New-Object System.Drawing.Size(590, 40)
$form.Controls.Add($ack)

$continue = New-Object System.Windows.Forms.Button
$continue.Text = 'I Acknowledge'
$continue.Enabled = $false
$continue.Width = 135
$continue.Height = 34
$continue.Location = New-Object System.Drawing.Point(455, 440)
$continue.Add_Click({ $form.DialogResult = [System.Windows.Forms.DialogResult]::OK; $form.Close() })
$form.Controls.Add($continue)

$ack.Add_CheckedChanged({ $continue.Enabled = $ack.Checked })
$form.AcceptButton = $continue

$result = $form.ShowDialog()
if ($result -eq [System.Windows.Forms.DialogResult]::OK -and $ack.Checked) { exit 0 }
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

async function runConsentFlow({ log = console.log } = {}) {
  const config = require('./config.js').loadConfig();
  if (config.consentAcceptedAt) return config;

  log('First run detected — waiting for monitoring consent.');

  const accepted = showConsentDialog();
  if (!accepted) {
    log('Monitoring consent was not accepted. Exiting.');
    process.exitCode = 1;
    throw new Error('Monitoring consent was not accepted.');
  }

  const saved = saveConfig({ consentAcceptedAt: new Date().toISOString() });
  log('Monitoring consent accepted.');
  return saved;
}

module.exports = { runConsentFlow };
