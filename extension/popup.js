const DEFAULT_API_URL = 'http://192.168.1.2:4000/api';

async function getApiUrl() {
  const { apiUrl } = await chrome.storage.local.get('apiUrl');
  if (apiUrl && !/^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/api\/?$/i.test(apiUrl)) {
    return apiUrl;
  }

  await chrome.storage.local.set({ apiUrl: DEFAULT_API_URL });
  return DEFAULT_API_URL;
}

async function getMachineId() {
  const { machineId } = await chrome.storage.local.get('machineId');
  if (machineId) return machineId;
  const id = crypto.randomUUID();
  await chrome.storage.local.set({ machineId: id });
  return id;
}

async function render() {
  const { deviceToken, employeeName } = await chrome.storage.local.get(['deviceToken', 'employeeName']);

  if (deviceToken) {
    document.getElementById('pairView').style.display = 'none';
    document.getElementById('pairedView').style.display = 'block';
    document.getElementById('employeeName').textContent = `Assigned to ${employeeName || 'Unknown'}`;
  } else {
    document.getElementById('pairView').style.display = 'block';
    document.getElementById('pairedView').style.display = 'none';
  }
}

document.getElementById('pairBtn').addEventListener('click', async () => {
  const code = document.getElementById('codeInput').value.trim();
  const errorEl = document.getElementById('pairError');
  errorEl.style.display = 'none';

  if (!/^\d{8}$/.test(code)) {
    errorEl.textContent = 'Enter the 8-digit enrollment code provided by IT.';
    errorEl.style.display = 'block';
    return;
  }

  try {
    const apiUrl = await getApiUrl();
    const machineId = await getMachineId();
    const browserName = navigator.userAgent.includes('Edg') ? 'Edge' : 'Chrome';

    const res = await fetch(`${apiUrl}/agent/enroll`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        code,
        machineId,
        hostname: `${browserName} — ${navigator.platform || 'Browser'}`,
        domain: null,
        domainUser: null,
        deviceType: 'browser-extension',
        agentVersion: chrome.runtime.getManifest().version,
      }),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Enrollment failed.');

    await chrome.storage.local.set({
      deviceToken: data.deviceToken,
      deviceId: data.deviceId,
      employeeId: data.employeeId,
      employeeName: data.employeeName,
    });

    await render();
  } catch (e) {
    errorEl.textContent = e.message;
    errorEl.style.display = 'block';
  }
});

render();
