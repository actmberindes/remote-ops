import fs from 'node:fs';
import path from 'node:path';

/**
 * Removes monitoring files that have exceeded their configured retention.
 * Database-backed cleanup remains responsible for removing old records; this
 * sweep additionally removes orphaned files that are no longer referenced.
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
    if (!existing || (!Number.isNaN(ts) && ts < existing)) liveByUrl.set(frame.url, ts);
  }

  let deleted = 0;

  const walk = dir => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
        try {
          if (fs.readdirSync(fullPath).length === 0) fs.rmdirSync(fullPath);
        } catch (_) {}
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

      let shouldDelete = false;
      if (screenshotTs !== undefined) {
        shouldDelete = !Number.isNaN(screenshotTs) && screenshotTs <= screenshotCutoff;
      } else if (liveTs !== undefined) {
        shouldDelete = !Number.isNaN(liveTs) && liveTs <= liveCutoff;
      } else {
        // Orphaned monitoring file: use filesystem modification time so files
        // left behind after DB cleanup are still subject to retention.
        shouldDelete = stat.mtimeMs <= Math.min(liveCutoff, screenshotCutoff);
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
