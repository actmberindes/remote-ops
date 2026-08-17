import { domainFromUrl, todayStr, accumulate, bufferToEntries, computeTransition } from './logic.js';

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${label}`);
  if (!cond) failures++;
}

console.log('--- domainFromUrl ---');
check('extracts hostname from https URL', domainFromUrl('https://github.com/foo/bar?x=1') === 'github.com');
check('extracts hostname from http URL', domainFromUrl('http://example.com/') === 'example.com');
check('rejects chrome:// internal pages', domainFromUrl('chrome://extensions/') === null);
check('rejects chrome-extension:// pages', domainFromUrl('chrome-extension://abcdefg/popup.html') === null);
check('rejects malformed URL', domainFromUrl('not a url') === null);
check('rejects undefined', domainFromUrl(undefined) === null);
check('strips subdomain correctly (keeps full hostname)', domainFromUrl('https://mail.google.com/mail/u/0/') === 'mail.google.com');

console.log('--- accumulate ---');
let buf = {};
buf = accumulate(buf, '2026-08-08', 'github.com', 30);
buf = accumulate(buf, '2026-08-08', 'github.com', 15);
buf = accumulate(buf, '2026-08-08', 'youtube.com', 10);
check('accumulates seconds for same domain/date', buf['2026-08-08|github.com'] === 45);
check('keeps separate domains separate', buf['2026-08-08|youtube.com'] === 10);
check('ignores zero/negative seconds', accumulate(buf, '2026-08-08', 'x.com', 0)['2026-08-08|x.com'] === undefined);
check('ignores null domain', accumulate(buf, '2026-08-08', null, 30)['2026-08-08|null'] === undefined);

console.log('--- bufferToEntries ---');
const entries = bufferToEntries({ '2026-08-08|github.com': 45.6, '2026-08-08|youtube.com': 10.2, '2026-08-07|old.com': 0 });
check('converts buffer to entries array', entries.length === 2);
check('rounds seconds', entries.find(e => e.domain === 'github.com').seconds === 46);
check('splits date and domain correctly', entries.find(e => e.domain === 'github.com').date === '2026-08-08');
check('drops zero-second entries', !entries.some(e => e.domain === 'old.com'));

console.log('--- computeTransition ---');
// Starting fresh, observing github.com -> opens a new segment
let state = computeTransition({ current: null, buffer: {}, observedDomain: 'github.com', now: 1000, date: '2026-08-08' });
check('opens a segment when none exists', state.current.domain === 'github.com' && state.current.startedAt === 1000);
check('marks changed=true on first observation', state.changed === true);

// 30 seconds later, still on github.com -> no change, no new segment
state = computeTransition({ current: state.current, buffer: state.buffer, observedDomain: 'github.com', now: 31000, date: '2026-08-08' });
check('same domain observed again -> no segment change', state.changed === false);
check('buffer NOT yet updated while staying on same domain', Object.keys(state.buffer).length === 0);

// switches to youtube.com after 60s total on github.com
state = computeTransition({ current: state.current, buffer: state.buffer, observedDomain: 'youtube.com', now: 61000, date: '2026-08-08' });
check('domain switch closes prior segment into buffer', state.buffer['2026-08-08|github.com'] === 60);
check('domain switch opens new segment for new domain', state.current.domain === 'youtube.com' && state.current.startedAt === 61000);

// goes idle (observedDomain null) after 20s on youtube.com
state = computeTransition({ current: state.current, buffer: state.buffer, observedDomain: null, now: 81000, date: '2026-08-08' });
check('going idle closes the open segment', state.buffer['2026-08-08|youtube.com'] === 20);
check('going idle clears current (no segment while idle)', state.current === null);

// coming back active on youtube.com starts a fresh segment (does not resume old one)
state = computeTransition({ current: state.current, buffer: state.buffer, observedDomain: 'youtube.com', now: 90000, date: '2026-08-08' });
check('returning from idle opens a NEW segment', state.current.domain === 'youtube.com' && state.current.startedAt === 90000);

console.log('');
console.log(failures === 0 ? 'ALL LOGIC TESTS PASSED' : `${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
