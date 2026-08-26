import { Router } from 'express';

import { getDepartmentDetail, getDepartmentList } from '../controllers/department.controller';

export const departmentRouter = Router();

departmentRouter.get('/', getDepartmentList);
departmentRouter.get('/:department', getDepartmentDetail);
