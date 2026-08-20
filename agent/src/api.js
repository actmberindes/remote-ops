const fs = require('node:fs');

async function request(apiUrl, path, { method = 'GET', body, token, isMultipart, filePath, fileFieldName = 'file' } = {}) {
  const url = `${apiUrl}${path}`;
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  let fetchBody;
  if (isMultipart) {
    const form = new FormData();
    const fileBuffer = fs.readFileSync(filePath);
    form.append(fileFieldName, new Blob([fileBuffer], { type: 'image/png' }), 'capture.png');
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
    enroll: (code, telemetry) =>
      request(apiUrl, '/agent/enroll', {
        method: 'POST',
        body: { code, ...telemetry },
      }),
    getConfig: (deviceToken) => request(apiUrl, '/agent/config', { token: deviceToken }),
    heartbeat: (deviceToken, telemetry) =>
      request(apiUrl, '/agent/heartbeat', { method: 'POST', token: deviceToken, body: telemetry }),
    uploadFile: (deviceToken, filePath) => request(apiUrl, '/uploads', { method: 'POST', token: deviceToken, isMultipart: true, filePath }),
    postScheduledScreenshot: (deviceToken, url, filename) =>
      request(apiUrl, '/activity/screenshots', { method: 'POST', token: deviceToken, body: { url, filename, capturedAt: new Date().toISOString() } }),
    postLiveFrame: (deviceToken, url) =>
      request(apiUrl, '/activity/live-frame', { method: 'POST', token: deviceToken, body: { url, capturedAt: new Date().toISOString() } }),
    postWebUsage: (deviceToken, entries) =>
      request(apiUrl, '/activity/web-usage', { method: 'POST', token: deviceToken, body: { entries } }),
  };
}

module.exports = { createClient };
