/** One headline figure, with an optional line of context beneath it. */

export type StatTone = 'neutral' | 'positive' | 'negative';

interface StatCardProps {
  readonly label: string;
  readonly value: string;
  /** Context for the figure — a share, a related amount. */
  readonly detail?: string;
  readonly tone?: StatTone;
}

const TONE_CLASS: Record<StatTone, string> = {
  neutral: 'text-ink',
  positive: 'text-positive',
  negative: 'text-negative',
};

export default function StatCard({ label, value, detail, tone = 'neutral' }: StatCardProps) {
  return (
    <div className="border-line bg-paper-raised rounded-lg border p-4">
      <p className="text-ink-muted text-xs">{label}</p>
      <p className={`tabular mt-1 text-2xl font-semibold ${TONE_CLASS[tone]}`}>{value}</p>
      {/* Reserved even when empty, so the cards keep a common baseline. */}
      <p className="text-ink-faint mt-1 min-h-4 text-xs">{detail ?? ''}</p>
    </div>
  );
}
