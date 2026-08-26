import { Router } from 'express';

import { dashboardRouter } from './dashboard.routes';
import { healthRouter } from './health.routes';
import { metaRouter } from './meta.routes';
import { uploadRouter } from './upload.routes';

export const apiRouter = Router();

apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/health', healthRouter);
apiRouter.use('/meta', metaRouter);
apiRouter.use('/uploads', uploadRouter);
