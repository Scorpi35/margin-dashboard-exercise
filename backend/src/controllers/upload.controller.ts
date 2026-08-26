import type { RequestHandler } from 'express';

import type { ApiSuccess, UploadHistoryEntry, UploadResult } from '@shared/types';

import { HttpError } from '../middleware/errorHandler';
import { UPLOAD_FIELD } from '../middleware/upload';
import { ingestUpload, readUploads } from '../services/ingest.service';
import { requireUploadType } from './validation';

/** `POST /api/uploads/:type` — replace the months a spreadsheet is authoritative for. */
export const postUpload: RequestHandler = (req, res, next) => {
  try {
    const type = requireUploadType(req.params.type);

    if (req.file === undefined) {
      throw new HttpError(400, `No file was attached. Send one in a "${UPLOAD_FIELD}" field.`);
    }

    const body: ApiSuccess<UploadResult> = {
      status: 'ok',
      data: ingestUpload(type, req.file.buffer, req.file.originalname),
    };

    res.status(201).json(body);
  } catch (err) {
    next(err);
  }
};

/** `GET /api/uploads` — what has been ingested, newest first. */
export const getUploads: RequestHandler = (_req, res, next) => {
  try {
    const body: ApiSuccess<UploadHistoryEntry[]> = { status: 'ok', data: readUploads() };

    res.json(body);
  } catch (err) {
    next(err);
  }
};
