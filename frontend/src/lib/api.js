const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000/api';
const TOKEN_KEY = 'rw_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(token) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request(path, { method = 'GET', body, auth = true } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth) {
    const token = getToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await res.json(); } catch (e) { /* empty body */ }
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  getToken, setToken,

  managers: () => request('/auth/managers', { auth: false }),
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password }, auth: false }),
  register: (form) => request('/auth/register', { method: 'POST', body: form, auth: false }),
  me: () => request('/auth/me'),

  users: {
    list: () => request('/users'),
    create: (form) => request('/users', { method: 'POST', body: form }),
    update: (id, form) => request(`/users/${id}`, { method: 'PUT', body: form }),
    remove: (id) => request(`/users/${id}`, { method: 'DELETE' }),
    setMyStatus: (status) => request('/users/me/status', { method: 'PATCH', body: { status } }),
  },

  applications: {
    list: () => request('/applications'),
    create: (form) => request('/applications', { method: 'POST', body: form }),
    patch: (id, body) => request(`/applications/${id}`, { method: 'PATCH', body }),
  },

  timeSessions: {
    list: () => request('/time-sessions'),
    create: (body) => request('/time-sessions', { method: 'POST', body }),
  },

  notifications: {
    list: () => request('/notifications'),
    markAllRead: () => request('/notifications/mark-all-read', { method: 'POST' }),
  },

  uploads: {
    upload: async (file) => {
      const headers = {};
      const token = getToken();
      if (token) headers.Authorization = `Bearer ${token}`;
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch(`${API_URL}/uploads`, { method: 'POST', headers, body: formData });
      let data = {};
      try { data = await res.json(); } catch (e) { /* empty body */ }
      if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
      return data; // { url, filename, mimeType, size }
    },
    fileUrl: (path) => (path && path.startsWith('/uploads/') ? `${API_URL.replace(/\/api$/, '')}${path}` : path),
  },

  tickets: {
    list: () => request('/tickets'),
    get: (id) => request(`/tickets/${id}`),
    create: (body) => request('/tickets', { method: 'POST', body }),
    addMessage: (id, body) => request(`/tickets/${id}/messages`, { method: 'POST', body }),
    close: (id) => request(`/tickets/${id}/close`, { method: 'PATCH' }),
    update: (id, body) => request(`/tickets/${id}`, { method: 'PATCH', body }),
    assignAsset: (id, assetId) => request(`/tickets/${id}/assign-asset`, { method: 'POST', body: { assetId } }),
  },

  assets: {
    list: () => request('/assets'),
    create: (body) => request('/assets', { method: 'POST', body }),
    update: (id, body) => request(`/assets/${id}`, { method: 'PUT', body }),
    remove: (id) => request(`/assets/${id}`, { method: 'DELETE' }),
    assign: (id, employeeId) => request(`/assets/${id}/assign`, { method: 'POST', body: { employeeId } }),
    bulkAssign: (id, employeeIds) => request(`/assets/${id}/bulk-assign`, { method: 'POST', body: { employeeIds } }),
    return: (id, employeeId) => request(`/assets/${id}/return`, { method: 'POST', body: employeeId !== undefined ? { employeeId } : undefined }),
    retire: (id) => request(`/assets/${id}/retire`, { method: 'POST' }),
    history: (id) => request(`/assets/${id}/history`),
  },

  activity: {
    liveView: () => request('/activity/live-view'),
    screenshots: ({ employeeId, date, limit } = {}) => {
      const params = new URLSearchParams();
      if (employeeId) params.set('employeeId', employeeId);
      if (date) params.set('date', date);
      if (limit) params.set('limit', limit);
      const qs = params.toString();
      return request(`/activity/screenshots${qs ? `?${qs}` : ''}`);
    },
    webUsage: ({ employeeId, date } = {}) => {
      const params = new URLSearchParams();
      if (employeeId) params.set('employeeId', employeeId);
      if (date) params.set('date', date);
      const qs = params.toString();
      return request(`/activity/web-usage${qs ? `?${qs}` : ''}`);
    },
  },

  agent: {
    pairingCode: () => request('/agent/pairing-code', { method: 'POST' }),
    devices: () => request('/agent/devices'),
    revokeDevice: (id) => request(`/agent/devices/${id}/revoke`, { method: 'PATCH' }),
    getConfig: () => request('/agent/config-admin'),
    updateConfig: (body) => request('/agent/config', { method: 'PUT', body }),
  },
};