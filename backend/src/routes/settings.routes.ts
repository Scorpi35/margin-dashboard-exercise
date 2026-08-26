import { Router } from 'express';

import { readSettings, writeSettings } from '../controllers/settings.controller';

export const settingsRouter = Router();

settingsRouter.get('/', readSettings);
settingsRouter.put('/', writeSettings);
