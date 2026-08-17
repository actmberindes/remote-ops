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
import { activityRouter } from './routes/activity.js';

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json());
app.use('/uploads', express.static(uploadsDir));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'remote-ops-backend' }));

app.use('/api/auth', authRouter);
app.use('/api/users', usersRouter);
app.use('/api/applications', applicationsRouter);
app.use('/api/time-sessions', timeSessionsRouter);
app.use('/api/notifications', notificationsRouter);
app.use('/api/tickets', ticketsRouter);
app.use('/api/assets', assetsRouter);
app.use('/api/asset-tags', assetTagsRouter);
app.use('/api/uploads', uploadsRouter);
app.use('/api/agent', agentRouter);
app.use('/api/activity', activityRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server.' });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`Remote Ops backend listening on http://localhost:${PORT}`));
