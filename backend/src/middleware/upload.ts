import multer, { MulterError } from 'multer';
import type { RequestHandler } from 'express';

import { requireUploadType } from '../controllers/validation';
import { HttpError } from './errorHandler';

/**
 * Accepting a spreadsheet upload.
 *
 * The file is held in memory and never touches disk — one agency-year is a few
 * thousand rows, and a temp file would only be something else to clean up.
 *
 * Anything that is not an `.xlsx`/`.xls` is rejected here, before a parser sees
 * the buffer. `loadWorkbook` checks the file signature as well, because an
 * extension is a claim rather than a fact; this is the cheaper first pass.
 */

const ALLOWED_EXTENSIONS = ['.xlsx', '.xls'];

/** Generous for a spreadsheet — the sample timesheet is 35 KB. */
const MAX_BYTES = 10 * 1024 * 1024;

/** The form field the file arrives under. */
export const UPLOAD_FIELD = 'file';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_BYTES, files: 1 },
  fileFilter: (_req, file, callback) => {
    const name = file.originalname.toLowerCase();
    if (ALLOWED_EXTENSIONS.some((extension) => name.endsWith(extension))) {
      callback(null, true);
      return;
    }

    callback(
      new HttpError(
        400,
        `"${file.originalname}" is not a spreadsheet. Upload an .xlsx or .xls file.`,
      ),
    );
  },
});

/**
 * Reads the single uploaded file onto `req.file`.
 *
 * Multer reports its own failures as `MulterError`, which would otherwise reach
 * the error handler as an unrecognised throw and be reported to the user as a
 * 500. They are all the caller's mistake, so they are translated here.
 */
export const singleSpreadsheet: RequestHandler = (req, res, next) => {
  upload.single(UPLOAD_FIELD)(req, res, (err: unknown) => {
    if (err instanceof MulterError) {
      next(new HttpError(400, describeMulterError(err)));
      return;
    }

    next(err);
  });
};

function describeMulterError(err: MulterError): string {
  switch (err.code) {
    case 'LIMIT_FILE_SIZE':
      return `That file is larger than ${MAX_BYTES / 1024 / 1024} MB.`;
    case 'LIMIT_FILE_COUNT':
    case 'LIMIT_UNEXPECTED_FILE':
      return `Send exactly one file, in a "${UPLOAD_FIELD}" field.`;
    default:
      return 'The upload could not be read. Try selecting the file again.';
  }
}

/**
 * Rejects an unknown `:type` before multer reads a byte.
 *
 * Ordered ahead of `singleSpreadsheet` in the router so a request to
 * `/api/uploads/salaries` fails on the path rather than after buffering the file.
 */
export const requireKnownType: RequestHandler = (req, _res, next) => {
  try {
    requireUploadType(req.params.type);
    next();
  } catch (err) {
    next(err);
  }
};
