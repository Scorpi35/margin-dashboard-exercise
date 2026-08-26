import { Link } from 'react-router-dom';

/**
 * Nothing has been ingested yet.
 *
 * A dashboard full of zeroes would read as "the agency did no work", which is a
 * different claim from "nobody has uploaded anything".
 */
export default function NoDataYet() {
  return (
    <div className="border-line bg-paper-raised rounded-lg border border-dashed p-10 text-center">
      <p className="text-ink text-sm font-medium">There is nothing to report yet.</p>
      <p className="text-ink-muted mx-auto mt-2 max-w-md text-sm">
        Upload the timesheet, the salary sheet and the project price list, and the numbers will
        appear here.
      </p>
      <Link
        to="/upload"
        className="bg-accent hover:bg-accent-hover mt-5 inline-block rounded-md px-4 py-2 text-sm font-medium text-white"
      >
        Go to Upload
      </Link>
    </div>
  );
}
