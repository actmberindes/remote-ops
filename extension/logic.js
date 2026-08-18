/**
 * Pure logic for page-level browser tracking.
 */

function pageFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return { url: u.href, domain: u.hostname };
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

function accumulate(buffer, date, url, domain, seconds, startedAt, endedAt) {
  if (!url || !(seconds > 0)) return buffer;

  const entry = {
    date,
    url,
    domain: domain || '',
    seconds,
    startedAt,
    endedAt,
  };

  return [...buffer, entry];
}

function bufferToEntries(buffer) {
  return (Array.isArray(buffer) ? buffer : Object.values(buffer || {}))
    .map(e => ({
      date: e.date,
      url: e.url || null,
      domain: e.domain || '',
      seconds: Math.round(Number(e.seconds) || 0),
      startedAt: e.startedAt || null,
      endedAt: e.endedAt || null,
    }))
    .filter(e => e.seconds > 0 && (e.url || e.domain));
}

function computeTransition({ current, buffer, observedPage, now = Date.now(), date = todayStr() }) {
  const currentUrl = current ? (current.url || null) : null;
  const observedUrl = observedPage ? observedPage.url : null;
  const pageChanged = currentUrl ? currentUrl !== observedUrl : !!observedPage;

  if (!pageChanged && currentUrl === observedUrl) {
    return { buffer, current, changed: false };
  }

  let nextBuffer = buffer;

  if (current) {
    const elapsedSeconds = Math.max(0, (now - current.startedAt) / 1000);
    if (current.url) {
      nextBuffer = accumulate(
        nextBuffer,
        current.date,
        current.url,
        current.domain,
        elapsedSeconds,
        new Date(current.startedAt).toISOString(),
        new Date(now).toISOString()
      );
    }
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
