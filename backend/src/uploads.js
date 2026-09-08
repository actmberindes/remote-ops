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
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const safeExt = /^\.[a-zA-Z0-9]+$/.test(ext) ? ext : '';
      cb(null, `${Date.now()}-${crypto.randomBytes(6).toString('hex')}${safeExt}`);
    },
  });
}

const allowedMimes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'];
const fileFilter = (req, file, cb) => cb(null, allowedMimes.includes(file.mimetype));

const upload = multer({
  storage: createStorage(uploadsDir),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 8 },
  fileFilter,
});

const monitoringUpload = multer({
  storage: createStorage(monitoringUploadsDir),
  limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 4 },
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

// Monitoring uploads are used for both scheduled Screenshots and Live View.
// Screenshots remain on disk for their configured retention period.
// Live View is explicitly memory-only: the temporary multipart file is read,
// moved into the bounded in-memory frame store, and deleted immediately.
uploadsRouter.post('/monitoring', runUpload(monitoringUpload, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No monitoring image uploaded, or file type not allowed.' });

  if (String(req.body?.purpose || '').toLowerCase() === 'live') {
    const buffer = await fs.promises.readFile(req.file.path);
    const token = putLiveFrame({
      deviceId: req.device?.id ?? null,
      employeeId: req.device?.currentEmployeeId || req.device?.employeeId || null,
      displayId: req.body?.displayId || null,
      displayName: req.body?.displayName || null,
      displayIndex: req.body?.displayIndex || 1,
      buffer,
      mimeType: req.file.mimetype,
    });

    cleanupFile(req.file);
    return res.status(201).json({
      live: true,
      liveFrameToken: token,
      mimeType: req.file.mimetype,
      size: req.file.size,
    });
  }

  res.status(201).json({
    url: `/uploads/monitoring/${req.file.filename}`,
    filename: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
  });
}));
