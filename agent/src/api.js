const fs = require('node:fs');

async function request(apiUrl, path, { method = 'GET', body, token, isMultipart, filePath, fileFieldName = 'file', multipartFields = {} } = {}) {
  const url = `${apiUrl}${path}`;
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  let fetchBody;
  if (isMultipart) {
    const form = new FormData();
    const fileBuffer = fs.readFileSync(filePath);
    form.append(fileFieldName, new Blob([fileBuffer], { type: 'image/png' }), 'capture.png');
    for (const [key, value] of Object.entries(multipartFields)) {
      if (value !== undefined && value !== null) form.append(key, String(value));
    }
    fetchBody = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    fetchBody = JSON.stringify(body);
  }

  const res = await fetch(url, { method, headers, body: fetchBody });
  let data = {};
  try { data = await res.json(); } catch (e) { /* empty body */ }
  if (!res.ok) {
    const err = new Error(data.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

function createClient(apiUrl) {
  return {
    enroll: (code, telemetry) => request(apiUrl, '/agent/enroll', { method: 'POST', body: { code, ...telemetry } }),
    getConfig: (deviceToken) => request(apiUrl, '/agent/config', { token: deviceToken }),
    heartbeat: (deviceToken, telemetry) => request(apiUrl, '/agent/heartbeat', { method: 'POST', token: deviceToken, body: telemetry }),
    authorizeQuit: (deviceToken, code) => request(apiUrl, '/agent/quit-authorize', { method: 'POST', token: deviceToken, body: { code } }),
    uploadFile: (deviceToken, filePath, purpose = 'screenshot') => request(apiUrl, '/uploads/monitoring', { method: 'POST', token: deviceToken, isMultipart: true, filePath, multipartFields: { purpose } }),
    postScheduledScreenshot: (deviceToken, url, filename, display = {}) => request(apiUrl, '/activity/screenshots', { method: 'POST', token: deviceToken, body: { url, filename, displayId: display.displayId ?? null, displayName: display.displayName ?? null, displayIndex: display.displayIndex ?? null, capturedAt: new Date().toISOString() } }),
    postLiveFrame: (deviceToken, liveFrameToken, display = {}) => request(apiUrl, '/activity/live-frame', { method: 'POST', token: deviceToken, body: { liveFrameToken, displayId: display.displayId ?? null, displayName: display.displayName ?? null, displayIndex: display.displayIndex ?? null, capturedAt: new Date().toISOString() } }),
    postWebUsage: (deviceToken, entries) => request(apiUrl, '/activity/web-usage', { method: 'POST', token: deviceToken, body: { entries } }),
  };
}

module.exports = { createClient };
