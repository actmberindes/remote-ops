import { Router } from 'express';
import { getVersionInfo } from '../version.js';

export const versionRouter = Router();

versionRouter.get('/', (req, res) => {
  res.json(getVersionInfo());
});
