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
  return latest ? `Signed report: ${latest}` : `No signed report yet. Run \`sponsifer report ${dealId}\`.`;
}

/**
 * Whether the server's on-air logger is running, as `runner.Status.to_json()`
 * in Python reports it. It arrives over the network, so it is parsed.
 */
export interface LoggerStatus {
  running: boolean;
  /** The deal being logged, or the one last asked for. */
  deal: string | null;
  since: string | null;
  /** The OBS sources being watched. */
  sources: string[];
  /** Conventional sources OBS does not have, which are therefore not being watched. */
  missing: string[];
  /** Why the logger is not running, when it said. */
  error: string | null;
  /** OBS asked for its WebSocket password and none was given. */
  needsPassword: boolean;
  /** Whether OBS is streaming. False unless the logger is running. */
  streamLive: boolean;
  /** Each watched placement as the running logger sees it this moment. Empty unless it is running. */
  placements: LoggerPlacement[];
  /** Things the creator should know that do not stop the logger, in the server's words. */
  warnings: string[];
}

/**
 * One placement's state now, from the session that writes the log. It is not
 * derived from the log: the log's open interval may be one an earlier run left
 * open, which is history.
 */
export interface LoggerPlacement {
  source: string;
  /** In the program feed, which is not the same as broadcast: the stream may not be live. */
  inProgram: boolean;
  /** When it went on air, if it is on air now. */
  onAirSince: string | null;
}

function strings(value: unknown): string[] | null {
  return Array.isArray(value) && value.every((v): v is string => typeof v === 'string') ? value : null;
}

function textOrNull(value: unknown): string | null | undefined {
  return value === null || typeof value === 'string' ? value : undefined;
}

function parsePlacements(value: unknown): LoggerPlacement[] | null {
  // A server started before these fields existed sends none. That is a logger
  // that reports nothing live, not a malformed answer.
  if (value === undefined) return [];
  if (!Array.isArray(value)) return null;
  const out: LoggerPlacement[] = [];
  for (const item of value as unknown[]) {
    if (typeof item !== 'object' || item === null) return null;
    const o = item as Record<string, unknown>; // narrowed field by field below
    const onAirSince = textOrNull(o.onAirSince);
    if (typeof o.source !== 'string' || typeof o.inProgram !== 'boolean' || onAirSince === undefined) return null;
    out.push({ source: o.source, inProgram: o.inProgram, onAirSince });
  }
  return out;
}

/** The status as typed data, or null when the answer is not one. */
export function parseLoggerStatus(data: unknown): LoggerStatus | null {
  if (typeof data !== 'object' || data === null) return null;
  const o = data as Record<string, unknown>; // narrowed field by field below
  const deal = textOrNull(o.deal);
  const since = textOrNull(o.since);
  const error = textOrNull(o.error);
  const sources = strings(o.sources);
  const missing = strings(o.missing);
  if (typeof o.running !== 'boolean' || typeof o.needsPassword !== 'boolean') return null;
  const placements = parsePlacements(o.placements);
  // As with the live fields, a server from before warnings existed sends none.
  const warnings = o.warnings === undefined ? [] : strings(o.warnings);
  if (deal === undefined || since === undefined || error === undefined || !sources || !missing || !placements || !warnings) return null;
  if (o.streamLive !== undefined && typeof o.streamLive !== 'boolean') return null;
  return {
    running: o.running, deal, since, sources, missing, error, needsPassword: o.needsPassword,
    streamLive: o.streamLive === true, placements, warnings,
  };
}

/** "14:02 UTC" from an ISO time, or the text itself when it is not one. */
export function clockOf(iso: string): string {
  const match = /T(\d{2}:\d{2})/.exec(iso);
  return match?.[1] ? `${match[1]} UTC` : iso;
}

/**
 * What the logger is doing, from the point of view of one deal's row. Says
 * what is not being watched, because a placement the log never saw is a minute
 * the report cannot claim.
 */
export function loggerSentence(status: LoggerStatus, dealId: string): string {
  if (status.running && status.deal !== dealId) {
    return `The logger is running for ${status.deal ?? 'another deal'}. Stop it there before logging this one.`;
  }
  if (status.running) {
    const parts = [`Logging since ${status.since ? clockOf(status.since) : 'just now'}`, `watching ${status.sources.join(', ')}`];
    if (status.missing.length > 0) parts.push(`not in OBS, so not watched: ${status.missing.join(', ')}`);
    return [`${parts.join('; ')}.`, ...status.warnings].join(' ');
  }
  if (status.deal === dealId && status.error) return status.error;
  return 'Not logging. Start it before you go live, so the log sees the stream begin.';
}
