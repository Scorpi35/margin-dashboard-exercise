import cors from 'cors';
import express from 'express';

import { apiRouter } from './routes';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';

export function createApp(): express.Express {
  const app = express();

  // In development the Vite proxy makes the API same-origin, so CORS only
  // matters when the built frontend is served from somewhere else.
  app.use(cors());
  app.use(express.json());

  app.use('/api', apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
