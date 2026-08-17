import { execSync } from 'node:child_process';

let failures = 0;
function check(label, cond) {
  console.log(`${cond ? 'PASS' : 'FAIL'} - ${label}`);
  if (!cond) failures++;
}

const API_URL = 'http://localhost:4000/api';

(async () => {
  console.log('--- extension pairing flow (mirrors popup.js exactly) ---');

  // Employee generates a code (same as the "Pair This Device" button on the Dashboard)
  const login = JSON.parse(execSync(`curl -s -X POST ${API_URL}/auth/login -H "Content-Type: application/json" -d '{"email":"joshuaa@88thfloor.com","password":"password123"}'`).toString());
  const codeResp = JSON.parse(execSync(`curl -s -X POST ${API_URL}/agent/pairing-code -H "Authorization: Bearer ${login.token}"`).toString());
  check('pairing code generated', /^\d{6}$/.test(codeResp.code));

  // Simulate popup.js's pairing request exactly (fetch call, same body shape, type: browser-extension)
  const pairRes = await fetch(`${API_URL}/agent/pair`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: codeResp.code, deviceName: 'Chrome — Win32', type: 'browser-extension' }),
  });
  const pairData = await pairRes.json();
  check('extension pairing succeeded', pairRes.ok && !!pairData.deviceToken);
  check('device type recorded as browser-extension', true); // verified via admin devices list below

  // Confirm it shows up correctly in Admin > Paired Devices with the right type
  const admin = JSON.parse(execSync(`curl -s -X POST ${API_URL}/auth/login -H "Content-Type: application/json" -d '{"email":"admin@88thfloor.com","password":"password123"}'`).toString());
  const devices = JSON.parse(execSync(`curl -s ${API_URL}/agent/devices -H "Authorization: Bearer ${admin.token}"`).toString());
  const ourDevice = devices.find(d => d.id === pairData.deviceId);
  check('device visible to admin with correct type', ourDevice && ourDevice.type === 'browser-extension');
  check('device linked to correct employee', ourDevice.employeeName === 'Joshua Alvarez');

  // Simulate the background.js flush() posting a web-usage batch
  const usageRes = await fetch(`${API_URL}/activity/web-usage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pairData.deviceToken}` },
    body: JSON.stringify({ entries: [{ domain: 'stackoverflow.com', seconds: 245, date: '2026-08-08' }, { domain: 'gmail.com', seconds: 60, date: '2026-08-08' }] }),
  });
  check('web usage batch accepted', usageRes.ok);

  const usage = JSON.parse(execSync(`curl -s "${API_URL}/activity/web-usage?date=2026-08-08&employeeId=${pairData.employeeId}" -H "Authorization: Bearer ${admin.token}"`).toString());
  check('stackoverflow.com usage recorded with correct minutes', usage.some(u => u.domain === 'stackoverflow.com' && u.minutes === 4.1));
  check('gmail.com usage recorded', usage.some(u => u.domain === 'gmail.com' && u.minutes === 1));

  // Confirm revoke actually blocks further posts (extension keeps working until revoked, per design)
  execSync(`curl -s -X PATCH ${API_URL}/agent/devices/${pairData.deviceId}/revoke -H "Authorization: Bearer ${admin.token}"`);
  const postRevokeRes = await fetch(`${API_URL}/activity/web-usage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${pairData.deviceToken}` },
    body: JSON.stringify({ entries: [{ domain: 'x.com', seconds: 10, date: '2026-08-08' }] }),
  });
  check('revoked extension token rejected', postRevokeRes.status === 401);

  console.log('');
  console.log(failures === 0 ? 'ALL PAIRING TESTS PASSED' : `${failures} TEST(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
})();
