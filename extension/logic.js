/**
 * Pure logic for page-level browser tracking, kept free of any `chrome.*` API calls
 * so it can be unit tested in plain Node without a real browser.
 * background.js is the thin Chrome-API wrapper around these functions.
 */

function pageFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return {
      url: u.href,
      domain: u.hostname,
    };
  } catch (e) {
    return null;
  }
}

function domainFromUrl(url) {
  const page = pageFromUrl(url);
  return page ? page.domain : null;
}

function todayStr(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

// Folds an elapsed segment (exact page URL + domain + seconds spent) into the accumulation buffer.
// buffer shape: { 'YYYY-MM-DD|<exact-url>': { date, url, domain, seconds } }
function accumulate(buffer, date, url, domain, seconds) {
  if (!url || !(seconds > 0)) return buffer;
  const key = JSON.stringify([date, url]);
  const existing = buffer[key] || { date, url, domain: domain || '', seconds: 0 };
  return {
    ...buffer,
    [key]: {
      ...existing,
      domain: existing.domain || domain || '',
      seconds: existing.seconds + seconds,
    },
  };
}

// Converts the buffer into the { domain, url, seconds, date } array the backend expects.
function bufferToEntries(buffer) {
  return Object.values(buffer)
    .map(entry => ({
      date: entry.date,
      url: entry.url,
      domain: entry.domain,
      seconds: Math.round(entry.seconds),
    }))
    .filter(e => e.url && e.seconds > 0);
}

// Given the current tracked page and a newly-observed page (or null if idle/unfocused/non-http tab),
// decides whether a segment boundary occurred and returns the updated state.
function computeTransition({ current, buffer, observedPage, now = Date.now(), date = todayStr() }) {
  const currentUrl = current ? current.url : null;
  const observedUrl = observedPage ? observedPage.url : null;
  const pageChanged = currentUrl !== observedUrl;

  if (!pageChanged) {
    return { buffer, current, changed: false };
  }

  let nextBuffer = buffer;
  if (current) {
    const elapsedSeconds = (now - current.startedAt) / 1000;
    nextBuffer = accumulate(
      nextBuffer,
      current.date,
      current.url,
      current.domain,
      elapsedSeconds
    );
  }

  const nextCurrent = observedPage
    ? {
        url: observedPage.url,
        domain: observedPage.domain,
        startedAt: now,
        date,
      }
    : null;

  return { buffer: nextBuffer, current: nextCurrent, changed: true };
}

export { pageFromUrl, domainFromUrl, todayStr, accumulate, bufferToEntries, computeTransition };
