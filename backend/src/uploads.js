import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { requireAuthOrDevice } from './auth.js';
import { db } from './db.js';
import { putLiveFrame } from './live-frame-store.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const uploadsDir = path.join(__dirname, '..', 'uploads');
export const monitoringUploadsDir = path.join(uploadsDir, 'monitoring');

fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(monitoringUploadsDir, { recursive: true });

function createStorage(destinationDir) {
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, destinationDir),
    filename: (req, file, cb) => cb(null, createFilename(file.originalname)),
  });
}

function createFilename(originalname = '') {
  const ext = path.extname(originalname);
  const safeExt = /^\.[a-zA-Z0-9]+$/.test(ext) ? ext : '';
  return `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${safeExt}`;
}

async function saveBufferToMonitoring(buffer, originalname) {
  const filename = createFilename(originalname);
  const filePath = path.join(monitoringUploadsDir, filename);
  await fs.promises.writeFile(filePath, buffer);
  return { filename, filePath };
}

const allowedMimes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'];
const fileFilter = (req, file, cb) => cb(null, allowedMimes.includes(file.mimetype));

const upload = multer({
  storage: createStorage(uploadsDir),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 8 },
  fileFilter,
});

// Monitoring captures can be large PNGs, especially on high-resolution or
// multi-monitor machines. Keep the normal upload limit conservative while
// allowing Live View / monitoring captures enough headroom.
const MONITORING_MAX_FILE_SIZE = 25 * 1024 * 1024;

const monitoringUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MONITORING_MAX_FILE_SIZE, files: 1, fields: 8 },
  fileFilter: (req, file, cb) => {
    const isImage = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.mimetype);
    cb(null, isImage);
  },
});

function requestWasAborted(req, err) {
  return Boolean(
    req.aborted ||
    err?.code === 'ECONNABORTED' ||
    err?.code === 'ECONNRESET' ||
    err?.message === 'Request aborted' ||
    /aborted|socket hang up|connection reset/i.test(String(err?.message || ''))
  );
}

function cleanupFile(file) {
  const filePath = file?.path;
  if (!filePath) return;
  fs.promises.unlink(filePath).catch(() => {});
}

function runUpload(middleware, handler) {
  return (req, res, next) => {
    middleware(req, res, async err => {
      if (err) {
        if (requestWasAborted(req, err)) {
          cleanupFile(req.file);
          return;
        }

        if (err instanceof multer.MulterError) {
          if (err.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({ error: 'Monitoring image is too large. Maximum size is 25 MB.' });
          }
          if (err.code === 'LIMIT_FIELD_COUNT') {
            return res.status(400).json({ error: 'Too many multipart fields.' });
          }
          return res.status(400).json({ error: `Upload failed: ${err.message}` });
        }

        return next(err);
      }

      try {
        await handler(req, res, next);
      } catch (error) {
        cleanupFile(req.file);
        if (requestWasAborted(req, error)) return;
        next(error);
      }
    });
  };
}

export const uploadsRouter = Router();
uploadsRouter.use(requireAuthOrDevice(db));

uploadsRouter.post('/', runUpload(upload, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded, or file type not allowed (images and PDFs only).' });
  res.status(201).json({
    url: `/uploads/${req.file.filename}`,
    filename: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
  });
}));

// Monitoring endpoint is shared by scheduled Screenshots and Live View.
// Only Screenshots are persisted. Live View uses the bounded in-memory store.
uploadsRouter.post('/monitoring', runUpload(monitoringUpload, async (req, res) => {
  if (!req.file?.buffer) return res.status(400).json({ error: 'No monitoring image uploaded, or file type not allowed.' });

  if (String(req.body?.purpose || '').toLowerCase() === 'live') {
    const token = putLiveFrame({
      deviceId: req.device?.id ?? null,
      employeeId: req.device?.currentEmployeeId || req.device?.employeeId || null,
      displayId: req.body?.displayId || null,
      displayName: req.body?.displayName || null,
      displayIndex: req.body?.displayIndex || 1,
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
    });

    return res.status(201).json({
      live: true,
      liveFrameToken: token,
      mimeType: req.file.mimetype,
      size: req.file.size,
    });
  }

  const saved = await saveBufferToMonitoring(req.file.buffer, req.file.originalname);
  return res.status(201).json({
    url: `/uploads/monitoring/${saved.filename}`,
    filename: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
  });
}));
