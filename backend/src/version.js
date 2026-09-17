export const REMOTE_OPS_VERSION = '1.0.0';
export const REMOTE_OPS_RELEASE_DATE = '2026-09-17';
export const REMOTE_OPS_RELEASE_COMMIT = '1585c2ee5f135a3be7129566eacc076fd9311fc5';

export const REMOTE_OPS_CHANGELOG = [
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
