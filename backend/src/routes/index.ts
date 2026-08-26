import { Router } from 'express';

import { categoryRouter } from './category.routes';
import { dashboardRouter } from './dashboard.routes';
import { healthRouter } from './health.routes';
import { metaRouter } from './meta.routes';
import { productivityRouter } from './productivity.routes';
import { projectRouter } from './project.routes';
import { uploadRouter } from './upload.routes';

export const apiRouter = Router();

apiRouter.use('/categories', categoryRouter);
apiRouter.use('/dashboard', dashboardRouter);
apiRouter.use('/health', healthRouter);
apiRouter.use('/meta', metaRouter);
apiRouter.use('/productivity', productivityRouter);
apiRouter.use('/projects', projectRouter);
apiRouter.use('/uploads', uploadRouter);
