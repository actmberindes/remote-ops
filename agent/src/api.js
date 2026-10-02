const REQUEST_TIMEOUT_MS = 15000;
const REQUEST_RETRIES = 3;
const RETRY_DELAY_MS = 1000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function request(apiUrl, path, { method = 'GET', body, token, isMultipart, fileBuffer, fileFieldName = 'file', multipartFields = {} } = {}) {
  const url = `${apiUrl}${path}`;
  let lastError = null;

  for (let attempt = 1; attempt <= REQUEST_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const headers = {};
      if (token) headers.Authorization = `Bearer ${token}`;

      let fetchBody;
      if (isMultipart) {
        const form = new FormData();
        for (const [key, value] of Object.entries(multipartFields)) form.append(key, String(value));
        form.append(fileFieldName, new Blob([fileBuffer], { type: 'image/png' }), 'capture.png');
        fetchBody = form;
      } else if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        fetchBody = JSON.stringify(body);
      }

      const res = await fetch(url, { method, headers, body: fetchBody, signal: controller.signal });
      let data = {};
      try { data = await res.json(); } catch (_) {}

      if (!res.ok) {
        const err = new Error(data.error || `Request failed (${res.status})`);
        err.status = res.status;
        throw err;
      }

      return data;
    } catch (error) {
      lastError = error?.name === 'AbortError'
        ? new Error(`Request timed out after ${REQUEST_TIMEOUT_MS}ms: ${method} ${path}`)
        : new Error(`Request failed: ${method} ${path}: ${error?.message || error}`);
      if (attempt < REQUEST_RETRIES) await sleep(RETRY_DELAY_MS * attempt);
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError || new Error(`Request failed: ${method} ${path}`);
}

function createClient(apiUrl) {
  return {
    enroll: (code, telemetry) => request(apiUrl, '/agent/enroll', { method: 'POST', body: { code, ...telemetry } }),
    getConfig: (deviceToken) => request(apiUrl, '/agent/config', { token: deviceToken }),
    heartbeat: (deviceToken, telemetry) => request(apiUrl, '/agent/heartbeat', { method: 'POST', token: deviceToken, body: telemetry }),
    authorizeQuit: (deviceToken, code) => request(apiUrl, '/agent/quit-authorize', { method: 'POST', token: deviceToken, body: { code } }),
    uploadFile: (deviceToken, imageBuffer, type = 'screenshot') => request(apiUrl, `/uploads/monitoring?type=${type === 'live' ? 'live' : 'screenshot'}`, { method: 'POST', token: deviceToken, isMultipart: true, fileBuffer: imageBuffer }),
    postScheduledScreenshot: (deviceToken, url, filename, display = {}, telemetry = {}) =>
      request(apiUrl, '/activity/screenshots', {
        method: 'POST',
        token: deviceToken,
        body: {
          url,
          filename,
          displayId: display.displayId ?? null,
          displayName: display.displayName ?? null,
          displayIndex: display.displayIndex ?? null,
          domainUser: telemetry.domainUser ?? null,
          sessionId: telemetry.sessionId ?? null,
          capturedAt: new Date().toISOString()
        }
      }),
    postLiveFrame: (deviceToken, url, display = {}, telemetry = {}) =>
      request(apiUrl, '/activity/live-frame', {
        method: 'POST',
        token: deviceToken,
        body: {
          url,
          displayId: display.displayId ?? null,
          displayName: display.displayName ?? null,
          displayIndex: display.displayIndex ?? null,
          domainUser: telemetry.domainUser ?? null,
          sessionId: telemetry.sessionId ?? null,
          capturedAt: new Date().toISOString()
        }
      }),
    postWebUsage: (deviceToken, entries) => request(apiUrl, '/activity/web-usage', { method: 'POST', token: deviceToken, body: { entries } }),
  };
}

module.exports = { createClient };
