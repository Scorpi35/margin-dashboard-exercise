import { getDb } from '../src/lib/db';

/**
 * Opens the database, or exits with the reason.
 *
 * Shared by `seed` and `selfcheck`. Both would otherwise die on an uncaught
 * `DatabaseUnavailableError`, printing a stack trace through `node_modules` above
 * the one line that says what to do about it.
 */
export function requireDatabase(): void {
  try {
    getDb();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }
}
