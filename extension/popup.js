async function getApiUrl() {
  const { apiUrl } = await chrome.storage.local.get('apiUrl');
  return apiUrl || 'http://192.168.1.2:4000/api';
}

async function render() {
  const { deviceToken, employeeName } = await chrome.storage.local.get(['deviceToken', 'employeeName']);
  if (deviceToken) {
    document.getElementById('pairView').style.display = 'none';
    document.getElementById('pairedView').style.display = 'block';
    document.getElementById('employeeName').textContent = `Paired as ${employeeName || 'Unknown'}`;
  } else {
    document.getElementById('pairView').style.display = 'block';
    document.getElementById('pairedView').style.display = 'none';
  }
}

document.getElementById('pairBtn').addEventListener('click', async () => {
  const code = document.getElementById('codeInput').value.trim();
  const errorEl = document.getElementById('pairError');
  errorEl.style.display = 'none';
  if (!/^\d{6}$/.test(code)) {
    errorEl.textContent = 'Enter the 6-digit code exactly as shown on your Dashboard.';
    errorEl.style.display = 'block';
    return;
  }

  try {
    const apiUrl = await getApiUrl();
    const res = await fetch(`${apiUrl}/agent/pair`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, deviceName: `${navigator.userAgent.includes('Edg') ? 'Edge' : 'Chrome'} — ${navigator.platform}`, type: 'browser-extension' }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Pairing failed.');

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

document.getElementById('unpairBtn').addEventListener('click', async () => {
  await chrome.storage.local.remove(['deviceToken', 'deviceId', 'employeeId', 'employeeName', 'buffer', 'current']);
  await render();
});

render();
