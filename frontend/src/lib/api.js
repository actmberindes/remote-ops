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
};
