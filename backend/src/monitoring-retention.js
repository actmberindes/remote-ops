import fs from 'node:fs';
import path from 'node:path';

/**
 * Removes monitoring files that have exceeded their configured retention.
 * New monitoring files are explicitly named live-* or screenshot-* so their
 * retention type is never ambiguous. Legacy files without a prefix are treated
 * as Live View files during the migration because old Live View history may
 * already have been purged from the database.
 */
export function purgeMonitoringFiles({ monitoringUploadsDir, liveViewDays = 3, screenshotDays = 3, screenshots = [], liveFrames = [], liveFrameHistory = [] }) {
  if (!monitoringUploadsDir || !fs.existsSync(monitoringUploadsDir)) return { deleted: 0 };

  const now = Date.now();
  const liveCutoff = now - Number(liveViewDays || 3) * 24 * 60 * 60 * 1000;
  const screenshotCutoff = now - Number(screenshotDays || 3) * 24 * 60 * 60 * 1000;

  const screenshotByUrl = new Map(
    (screenshots || []).filter(x => x?.url).map(x => [x.url, new Date(x.capturedAt).getTime()])
  );
  const liveByUrl = new Map();
  for (const frame of [...(liveFrames || []), ...(liveFrameHistory || [])]) {
    if (!frame?.url) continue;
    const ts = new Date(frame.capturedAt).getTime();
    const existing = liveByUrl.get(frame.url);
    if (existing === undefined || (!Number.isNaN(ts) && ts < existing)) liveByUrl.set(frame.url, ts);
  }

  let deleted = 0;

  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }

      let stat;
      try {
        stat = fs.statSync(fullPath);
      } catch (_) {
        continue;
      }

      const relative = path.relative(monitoringUploadsDir, fullPath).replace(/\\/g, '/');
      const url = `/uploads/monitoring/${relative}`;
      const screenshotTs = screenshotByUrl.get(url);
      const liveTs = liveByUrl.get(url);
      const basename = path.basename(relative).toLowerCase();

      let shouldDelete = false;
      if (screenshotTs !== undefined) {
        // A file referenced by a screenshot record always follows the
        // independent screenshot retention period.
        shouldDelete = !Number.isNaN(screenshotTs) && screenshotTs <= screenshotCutoff;
      } else if (liveTs !== undefined) {
        shouldDelete = !Number.isNaN(liveTs) && liveTs <= liveCutoff;
      } else if (basename.startsWith('screenshot-')) {
        // Future screenshot uploads are explicitly classified by filename.
        shouldDelete = stat.mtimeMs <= screenshotCutoff;
      } else if (basename.startsWith('live-')) {
        // Future Live View uploads are explicitly classified by filename.
        shouldDelete = stat.mtimeMs <= liveCutoff;
      } else {
        // Legacy files were uploaded before monitoring uploads had a type marker.
        // Existing screenshot records above are protected by their 3-day rule;
        // remaining legacy files are the old Live View capture pool and use the
        // 5-minute Live View retention.
        shouldDelete = stat.mtimeMs <= liveCutoff;
      }

      if (!shouldDelete) continue;

      try {
        fs.unlinkSync(fullPath);
        deleted += 1;
      } catch (e) {
        console.warn(`Unable to delete retained monitoring file ${fullPath}: ${e.message}`);
      }
    }
  };

  walk(monitoringUploadsDir);
  return { deleted };
}
