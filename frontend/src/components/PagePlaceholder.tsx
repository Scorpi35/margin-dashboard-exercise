interface PagePlaceholderProps {
  readonly title: string;
  readonly description: string;
  /** The issue that fills this page in, so the shell says what is still missing. */
  readonly plannedIn: string;
}

/**
 * A route that exists but has no feature behind it yet.
 *
 * Says so plainly rather than rendering an empty panel — an unexplained blank
 * screen reads as a bug.
 */
export default function PagePlaceholder({ title, description, plannedIn }: PagePlaceholderProps) {
  return (
    <section>
      <h1 className="text-ink text-xl font-semibold">{title}</h1>
      <p className="text-ink-muted mt-1 text-sm">{description}</p>

      <div className="border-line bg-paper-raised mt-6 rounded-lg border border-dashed p-8 text-center">
        <p className="text-ink-muted text-sm">Not built yet.</p>
        <p className="text-ink-faint mt-1 text-xs">Planned in {plannedIn}.</p>
      </div>
    </section>
  );
}
