/**
 * Pure logic for domain-time tracking, kept free of any `chrome.*` API calls
 * so it can be unit tested in plain Node without a real browser.
 * background.js is the thin Chrome-API wrapper around these functions.
 */

function domainFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.hostname;
  } catch (e) {
    return null;
  }
}

function todayStr(now = new Date()) {
  return now.toISOString().slice(0, 10);
}

// Folds an elapsed segment (domain + seconds spent) into the accumulation buffer.
// buffer shape: { "YYYY-MM-DD|domain": secondsAccumulated }
function accumulate(buffer, date, domain, seconds) {
  if (!domain || !(seconds > 0)) return buffer;
  const key = `${date}|${domain}`;
  return { ...buffer, [key]: (buffer[key] || 0) + seconds };
}

// Converts the buffer into the { domain, seconds, date } array the backend expects,
// dropping any zero/negative entries.
function bufferToEntries(buffer) {
  return Object.entries(buffer)
    .map(([key, seconds]) => {
      const sep = key.indexOf('|');
      return { date: key.slice(0, sep), domain: key.slice(sep + 1), seconds: Math.round(seconds) };
    })
    .filter(e => e.seconds > 0);
}

// Given the current tracked segment and a newly-observed domain (or null if idle/unfocused/
// non-http tab), decides whether a segment boundary occurred and returns the updated state.
// Only touches buffer/current when a real transition happens — safe to call repeatedly with
// an unchanged observation without any risk of double-counting.
function computeTransition({ current, buffer, observedDomain, now = Date.now(), date = todayStr() }) {
  const domainChanged = current ? current.domain !== observedDomain : observedDomain !== null;
  if (!domainChanged) {
    return { buffer, current, changed: false };
  }

  let nextBuffer = buffer;
  if (current) {
    const elapsedSeconds = (now - current.startedAt) / 1000;
    nextBuffer = accumulate(nextBuffer, current.date, current.domain, elapsedSeconds);
  }
  const nextCurrent = observedDomain ? { domain: observedDomain, startedAt: now, date } : null;
  return { buffer: nextBuffer, current: nextCurrent, changed: true };
}

export { domainFromUrl, todayStr, accumulate, bufferToEntries, computeTransition };
