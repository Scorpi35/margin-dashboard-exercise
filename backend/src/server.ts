import { createApp } from './app';
import { env } from './config/env';
import { getDb } from './lib/db';

/**
 * Open the database before listening.
 *
 * `better-sqlite3` binds its native module lazily, so without this the server
 * starts cleanly on an unsupported Node and then fails every request that
 * touches data — which reads like a bug in the upload code rather than a setup
 * problem. Better to refuse to start and say why.
 */
try {
  getDb();
} catch (err) {
  console.error(`[api] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}

const app = createApp();

app.listen(env.port, () => {
  console.log(`[api] listening on http://localhost:${env.port} (${env.nodeEnv})`);
});
