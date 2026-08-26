import { Router } from 'express';

import { getUploads, postUpload } from '../controllers/upload.controller';
import { requireKnownType, singleSpreadsheet } from '../middleware/upload';

export const uploadRouter = Router();

uploadRouter.get('/', getUploads);
uploadRouter.post('/:type', requireKnownType, singleSpreadsheet, postUpload);
