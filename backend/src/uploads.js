import { Router } from 'express';
import multer from 'multer';
import path from 'node:path';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { requireAuthOrDevice } from './auth.js';
import { db } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const uploadsDir = path.join(__dirname, '..', 'uploads');
export const monitoringUploadsDir = path.join(uploadsDir, 'monitoring');
export const liveMonitoringUploadsDir = path.join(monitoringUploadsDir, 'live');
export const screenshotMonitoringUploadsDir = path.join(monitoringUploadsDir, 'screenshots');

fs.mkdirSync(uploadsDir, { recursive: true });
fs.mkdirSync(liveMonitoringUploadsDir, { recursive: true });
fs.mkdirSync(screenshotMonitoringUploadsDir, { recursive: true });

function createStorage(destinationDir, monitoringType = null) {
  return multer.diskStorage({
    destination: (req, file, cb) => cb(null, destinationDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname);
      const safeExt = /^\.[a-zA-Z0-9]+$/.test(ext) ? ext : '';
      const prefix = monitoringType ? `${monitoringType}-` : '';
      cb(null, `${prefix}${Date.now()}-${crypto.randomBytes(6).toString('hex')}${safeExt}`);
    },
  });
}

const allowedMimes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'application/pdf'];
const fileFilter = (req, file, cb) => cb(null, allowedMimes.includes(file.mimetype));

const upload = multer({
  storage: createStorage(uploadsDir),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter,
});

export const uploadsRouter = Router();
uploadsRouter.use(requireAuthOrDevice(db));

uploadsRouter.post('/', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded, or file type not allowed (images and PDFs only).' });
  res.status(201).json({
    url: `/uploads/${req.file.filename}`,
    filename: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
  });
});

// Monitoring captures are physically separated so retention can never confuse
// Live View frames with scheduled screenshots.
uploadsRouter.post('/monitoring', (req, res, next) => {
  const type = req.query.type === 'live' ? 'live' : 'screenshot';
  const destinationDir = type === 'live' ? liveMonitoringUploadsDir : screenshotMonitoringUploadsDir;
  req.monitoringType = type;
  const dynamicUpload = multer({
    storage: createStorage(destinationDir, type),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (innerReq, file, cb) => {
      const isImage = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.mimetype);
      cb(null, isImage);
    },
  });
  dynamicUpload.single('file')(req, res, next);
}, (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No monitoring image uploaded, or file type not allowed.' });
  res.status(201).json({
    url: `/uploads/monitoring/${req.monitoringType === 'live' ? 'live' : 'screenshots'}/${req.file.filename}`,
    filename: req.file.originalname,
    mimeType: req.file.mimetype,
    size: req.file.size,
  });
});