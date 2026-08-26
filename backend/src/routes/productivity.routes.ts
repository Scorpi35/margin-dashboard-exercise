import { Router } from 'express';

import { getProductivityRows } from '../controllers/productivity.controller';

export const productivityRouter = Router();

productivityRouter.get('/', getProductivityRows);
