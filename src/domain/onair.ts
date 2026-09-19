/**
 * What the on-air log adds up to, as the server reports it.
 *
 * The shape mirrors `onair.Delivery.to_json()` in Python, which is the only
 * reader of the log, so the app and the delivery report cannot count
 * differently. This module only turns the numbers into sentences.
 */

export interface OnAirInterval {
  /** The OBS source that was on air: which placement this was. */
  source: string;
  start: string;
  end: string;
  seconds: number;
  /** Seconds from the stream's start, or null when the logger never saw it start. */
  streamOffsetSeconds: number | null;
}

/** What one placement adds up to. */
export interface OnAirPlacement {
  source: string;
  totalSeconds: number;
  intervals: number;
  openSince: string | null;
}

export interface OnAirSummary {
  deal: string;
  /** The OBS sources the logger watched, the corner emblem's first. */
  sources: string[];
  streamStartedAt: string | null;
  startObserved: boolean;
  intervals: OnAirInterval[];
  placements: OnAirPlacement[];
  /** Time with at least one placement on air; two up at once are counted once. */
  totalSeconds: number;
  /** Direct checks of OBS that contradicted an event it had sent. */
  disagreements: number;
  /** An interval the logger stopped inside, if any. */
  openSince: string | null;
  /** Names of signed delivery reports for this deal, oldest first. */
  reports: string[];
}

/** "1h 02m", "12m", "45s". */
export function spanOf(seconds: number): string {
  const whole = Math.round(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${whole}s`;
}

/** One sentence on what the log shows, saying what it could not settle rather than hiding it. */
export function onAirSentence(summary: OnAirSummary): string {
  const n = summary.intervals.length;
  const parts: string[] = [];
  if (n === 0) {
    parts.push(summary.openSince ? 'On air now, or the logger stopped while it was' : 'Logged, but never on air');
  } else {
    parts.push(`On air ${spanOf(summary.totalSeconds)} across ${n} interval${n === 1 ? '' : 's'}`);
    if (summary.openSince) parts.push('with one still open');
  }
  if (summary.disagreements > 0) {
    parts.push(`${summary.disagreements} direct check${summary.disagreements === 1 ? '' : 's'} contradicted an OBS event`);
  }
  if (!summary.startObserved && n > 0) parts.push('offsets into the recording unknown');
  return `${parts.join('; ')}.`;
}

/** Each placement's own time on air, when the deal had more than one. Empty otherwise. */
export function placementSentence(summary: OnAirSummary): string {
  const up = summary.placements.filter((p) => p.intervals > 0);
  if (up.length < 2) return '';
  return `${up.map((p) => `${p.source} ${spanOf(p.totalSeconds)}`).join(', ')}.`;
}

/** The report to send, or what to run to make one. */
export function reportSentence(summary: OnAirSummary, dealId: string): string {
  const latest = summary.reports[summary.reports.length - 1];
  return latest ? `Signed report: ${latest}` : `No signed report yet. Run \`sponsifable report ${dealId}\`.`;
}
