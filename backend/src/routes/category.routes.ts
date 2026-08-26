import { Router } from 'express';

import { getCategories } from '../controllers/category.controller';

export const categoryRouter = Router();

categoryRouter.get('/', getCategories);
