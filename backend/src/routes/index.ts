import { Router } from 'express';

import { healthRouter } from './health.routes';
import { uploadRouter } from './upload.routes';

export const apiRouter = Router();

apiRouter.use('/health', healthRouter);
apiRouter.use('/uploads', uploadRouter);
