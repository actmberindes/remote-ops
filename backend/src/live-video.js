import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

export function buildLiveVideo({ frames, monitoringUploadsDir }) {
  if (!Array.isArray(frames) || frames.length < 2) {
    throw new Error('At least 2 retained Live View frames are required to generate a video.');
  }

  const root = path.resolve(monitoringUploadsDir);
  const safeFrames = frames
    .map(frame => {
      if (!frame?.url || !frame.url.startsWith('/uploads/monitoring/')) return null;
      const relative = frame.url.slice('/uploads/monitoring/'.length).replace(/\\/g, '/');
      const filePath = path.resolve(root, relative);
      if (!filePath.startsWith(`${root}${path.sep}`)) return null;
      if (!fs.existsSync(filePath)) return null;
      return { ...frame, filePath };
    })
    .filter(Boolean)
    .sort((a, b) => new Date(a.capturedAt).getTime() - new Date(b.capturedAt).getTime());

  if (safeFrames.length < 2) {
    throw new Error('Fewer than 2 retained frame files are available on disk.');
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'remote-ops-live-video-'));
  const concatPath = path.join(tempDir, 'frames.txt');
  const outputPath = path.join(tempDir, `live-view-${crypto.randomBytes(6).toString('hex')}.mp4`);

  const lines = [];
  for (const frame of safeFrames) {
    const escaped = frame.filePath.replace(/'/g, "'\\''");
    lines.push(`file '${escaped}'`);
    lines.push('duration 0.2');
  }
  const lastEscaped = safeFrames[safeFrames.length - 1].filePath.replace(/'/g, "'\\''");
  lines.push(`file '${lastEscaped}'`);
  fs.writeFileSync(concatPath, `${lines.join('\n')}\n`, 'utf8');

  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-hide_banner',
      '-loglevel', 'error',
      '-y',
      '-f', 'concat',
      '-safe', '0',
      '-i', concatPath,
      '-vf', 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2',
      '-r', '5',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart',
      outputPath,
    ]);

    let stderr = '';
    ffmpeg.stderr.on('data', chunk => { stderr += chunk.toString(); });

    ffmpeg.on('error', err => {
      fs.rmSync(tempDir, { recursive: true, force: true });
      if (err.code === 'ENOENT') {
        reject(new Error('FFmpeg is not installed or is not available on the backend PATH.'));
      } else {
        reject(err);
      }
    });

    ffmpeg.on('close', code => {
      if (code !== 0 || !fs.existsSync(outputPath)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
        reject(new Error(stderr.trim() || `FFmpeg exited with code ${code}.`));
        return;
      }
      resolve({ outputPath, tempDir, frameCount: safeFrames.length });
    });
  });
}
