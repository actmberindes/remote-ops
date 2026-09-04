/* Keeps Live View updates smooth by waiting for incoming frame images before the
   existing monitoring enhancer swaps the rendered grid. Failed/slow frames do
   not block forever; the previous rendered frame stays visible. */

const LIVE_VIEW_PATH = '/activity/live-view';
const MAX_PRELOAD_MS = 4500;
const PATCH_FLAG = '__remoteOpsLiveViewFetchPatched';

function isLiveViewRequest(input) {
  try {
    const url = typeof input === 'string' ? input : input?.url;
    return String(url || '').includes(LIVE_VIEW_PATH);
  } catch (_) {
    return false;
  }
}

function absoluteUrl(url) {
  if (!url) return null;
  if (/^https?:\/\//i.test(url)) return url;
  const apiUrl = import.meta.env.VITE_API_URL || 'http://192.168.1.2:4000/api';
  return `${apiUrl.replace(/\/?$/, '')}${url.startsWith('/') ? url : `/${url}`}`;
}

function preloadImage(url) {
  const src = absoluteUrl(url);
  if (!src) return Promise.resolve(true);

  return new Promise(resolve => {
    const img = new Image();
    let done = false;
    const finish = result => {
      if (done) return;
      done = true;
      resolve(result);
    };

    const timer = setTimeout(() => finish(false), MAX_PRELOAD_MS);
    img.onload = () => {
      clearTimeout(timer);
      // decode() gives the browser time to finish decoding before the existing
      // Live View renderer replaces the DOM image element.
      if (typeof img.decode === 'function') {
        img.decode().then(() => finish(true)).catch(() => finish(true));
      } else {
        finish(true);
      }
    };
    img.onerror = () => {
      clearTimeout(timer);
      finish(false);
    };
    img.src = src;
  });
}

async function preloadLiveFrames(data) {
  const urls = [];
  for (const item of Array.isArray(data) ? data : []) {
    for (const display of Array.isArray(item?.displays) ? item.displays : []) {
      if (display?.frameUrl) urls.push(display.frameUrl);
    }
  }

  const unique = [...new Set(urls)];
  if (!unique.length) return;
  await Promise.allSettled(unique.map(preloadImage));
}

function patchFetch() {
  if (window[PATCH_FLAG]) return;
  const originalFetch = window.fetch.bind(window);

  window.fetch = async function patchedFetch(input, init) {
    const response = await originalFetch(input, init);
    if (!isLiveViewRequest(input) || !response.ok) return response;

    try {
      const clone = response.clone();
      const data = await clone.json();
      await preloadLiveFrames(data);
    } catch (_) {
      // Do not break Live View if a response is not JSON or preloading fails.
    }

    return response;
  };

  window[PATCH_FLAG] = true;
}

patchFetch();
export {};
