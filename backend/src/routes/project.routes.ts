import { Router } from 'express';

import { getProjectDetail, getProjects } from '../controllers/project.controller';

export const projectRouter = Router();

projectRouter.get('/', getProjects);
projectRouter.get('/:refCode', getProjectDetail);
