export const REMOTE_OPS_VERSION = '1.1.0';
export const REMOTE_OPS_RELEASE_DATE = '2026-09-25';
export const REMOTE_OPS_RELEASE_COMMIT = 'b2776b0bf699f9768d00687e85b0f12d5e91c896';

export const REMOTE_OPS_CHANGELOG = [
  {
    version: '1.1.0',
    date: '2026-09-25',
    commit: 'b2776b0bf699f9768d00687e85b0f12d5e91c896',
    title: 'Multi-user session-aware monitoring',
    changes: [
      'Added Windows WTS session-aware identity detection for shared devices and Fast User Switching.',
      'Monitoring now binds captures and heartbeat telemetry to the active Windows session ID.',
      'Historical screenshots and Live View frames retain the user/session identity present at capture time.',
      'Preserved RDP locked-session monitoring behavior while distinguishing it from local workstation lock.',
      'Windows Agent updated to v2.1.0.',
    ],
  },
  {
    version: '1.0.1',
    date: '2026-09-22',
    commit: '2143520a09c9fbf7ebf3953f57cd54e78663eee5',
    title: 'Capture storage cleanup',
    changes: [
      'Changed live and scheduled screenshot capture to stay in memory during upload.',
      'Removed agent-created screenshot files from the Windows TEMP workflow.',
      'Updated RDP locked-session monitoring so Live View frames and screenshots continue capturing while the RDP session is locked.',
    ],
  },
  {
    version: '1.0.0',
    date: '2026-09-17',
    commit: '1585c2ee5f135a3be7129566eacc076fd9311fc5',
    title: 'Stable baseline',
    changes: [
      'Established the first tracked Remote Ops portal release.',
      'Introduced version and release metadata for future changes.',
    ],
  },
];

export function getVersionInfo() {
  return {
    application: 'Remote Ops',
    version: REMOTE_OPS_VERSION,
    releaseDate: REMOTE_OPS_RELEASE_DATE,
    releaseCommit: REMOTE_OPS_RELEASE_COMMIT,
    agentVersion: '2.1.0',
    changelog: REMOTE_OPS_CHANGELOG,
  };
}
