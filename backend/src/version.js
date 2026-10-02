export const REMOTE_OPS_VERSION = '1.0.1';
export const REMOTE_OPS_RELEASE_DATE = '2026-09-22';
export const REMOTE_OPS_RELEASE_COMMIT = '2143520a09c9fbf7ebf3953f57cd54e78663eee5';

export const REMOTE_OPS_CHANGELOG = [
  {
    version: '1.0.1',
    date: '2026-09-22',
    commit: '2143520a09c9fbf7ebf3953f57cd54e78663eee5',
    title: 'Capture storage cleanup',
    changes: [
      'Changed live and scheduled screenshot capture to stay in memory during upload.',
      'Removed agent-created screenshot files from the Windows TEMP workflow.',
      'Windows Agent remains tracked as v2.0.1.',
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
    agentVersion: '2.0.1',
    changelog: REMOTE_OPS_CHANGELOG,
  };
}
