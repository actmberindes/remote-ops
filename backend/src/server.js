import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { authRouter } from './routes/auth.js';
import { usersRouter } from './routes/users.js';
import { applicationsRouter } from './routes/applications.js';
import { timeSessionsRouter } from './routes/timesessions.js';
import { notificationsRouter } from './routes/notifications.js';
import { ticketsRouter } from './routes/tickets.js';
import { assetsRouter } from './routes/assets.js';
import { assetTagsRouter } from './routes/asset-tags.js';
import { uploadsRouter, uploadsDir } from './uploads.js';
import { agentRouter } from './routes/agent.js';
import { activityRouter, purgeOldActivity } from './routes/activity.js';
import { multiDisplayActivityRouter } from './routes/activity-multi-display.js';
import { db, nextAssetTag } from './db.js';
import { purgeMonitoringFiles } from './monitoring-retention.js';

const app = express();

const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || 'http://192.168.1.2:5173,http://localhost:5173')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean)
);

const corsOptions = {
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error(`CORS origin not allowed: ${origin}`));
  },
  methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  optionsSuccessStatus: 204,
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'remote-ops-backend' }));

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/applications', applicationsRouter);
app.use('/api/time-sessions', timeSessionsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/tickets', ticketsRouter);

app.use('/api/assets', (req, res, next) => {
  if (req.method !== 'POST' || !req.body?.type) return next();
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    if (body?.id && body?.assetTag) {
      const asset = db.data.assets.find(a => a.id === Number(body.id));
      if (asset) {
        const tag = nextAssetTag(req.body.type);
        asset.assetTag = tag;
        void db.write();
        body = { ...body, assetTag: tag };
      }
    }
    return originalJson(body);
  };
  next();
});
app.use('/api/assets', assetsRouter);
app.use('/api/asset-tags', assetTagsRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/agent', agentRouter);

// Live View timelapse/video generation has been removed from the portal.
// Keep the old route blocked so stale clients cannot generate new videos.
app.use('/api/activity/live-video', (req, res) => {
  res.status(410).json({ error: 'Live View Timelapse video generation has been removed.' });
});

// Multi-display activity endpoints must run before the legacy single-display
// activity router so the same URLs can transparently support multiple screens.
app.use('/api/activity', multiDisplayActivityRouter);
app.use('/api/activity', activityRouter);

async function runMonitoringRetention() {
  purgeOldActivity();
  purgeMonitoringFiles({
    monitoringUploadsDir: `${uploadsDir}/monitoring`,
    liveViewDays: db.data.agentConfig.liveViewRetentionDays,
    screenshotDays: db.data.agentConfig.screenshotRetentionDays,
    screenshots: db.data.screenshots,
    liveFrames: db.data.liveFrames,
    liveFrameHistory: db.data.liveFrameHistory,
  });
  await db.write();
}

try {
  await runMonitoringRetention();
} catch (err) {
  console.error(`Initial monitoring retention cleanup failed: ${err.message}`);
}

const RETENTION_SWEEP_MS = 60 * 60 * 1000;
setInterval(async () => {
  try {
    await runMonitoringRetention();
  } catch (err) {
    console.error(`Monitoring retention sweep failed: ${err.message}`);
  }
}, RETENTION_SWEEP_MS).unref();

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

const PORT = process.env.PORT || 4000;
const HOST = process.env.HOST || '0.0.0.0';
app.listen(PORT, HOST, () => {
  console.log(`Remote Ops backend listening on http://${HOST}:${PORT}`);
});
