const API_URL = import.meta.env.VITE_API_URL || 'http://192.168.1.2:4000/api';
const TOKEN_KEY = 'rw_token';

if (!window.__remoteOpsCostPreserverInstalled) {
  window.__remoteOpsCostPreserverInstalled = true;
  const priorFetch = window.fetch.bind(window);
  const originalFetch = window.__remoteOpsOriginalFetch || priorFetch;

  window.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input?.url || '';
    const method = (init.method || (typeof input !== 'string' ? input.method : 'GET') || 'GET').toUpperCase();

    if (url.includes('/assets/') && method === 'PUT' && typeof init.body === 'string') {
      try {
        const body = JSON.parse(init.body);
        if (body.cost === null || body.cost === '' || body.cost === undefined) {
          const auth = TOKEN_KEY ? localStorage.getItem(TOKEN_KEY) : null;
          const res = await originalFetch(`${API_URL}/assets`, { headers: auth ? { Authorization: `Bearer ${auth}` } : {} });
          if (res.ok) {
            const assets = await res.json();
            const existing = Array.isArray(assets) ? assets.find(a => a.assetTag === body.assetTag) : null;
            if (existing && existing.cost !== null && existing.cost !== undefined) {
              body.cost = Number(existing.cost);
              init = { ...init, body: JSON.stringify(body) };
            }
          }
        }
      } catch (_) {}
    }

    return priorFetch(input, init);
  };
}
