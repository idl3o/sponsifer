/**
 * The documents a sponsor is sent, read for display: a delivery report, an
 * airtime report, or a licence receipt. Each is JSON written by `sponsifer`,
 * signed byte for byte, and each kind has its own SSHSIG namespace, so a
 * signature over one can never pass as a signature over another.
 *
 * Parsing is for display only. The signature is checked over the file's exact
 * bytes, never over anything rebuilt from this parse.
 */

import type { Bytes } from './sshsig';

export type DocumentKind = 'delivery-report' | 'airtime-report' | 'receipt';

/** The namespace each kind is signed under: `report.NAMESPACE` and `sshsig.NAMESPACE` in the Python package. */
export const NAMESPACE: Readonly<Record<DocumentKind, string>> = {
  'delivery-report': 'sponsifer-delivery',
  'airtime-report': 'sponsifer-delivery',
  receipt: 'sponsifer-receipt',
};

export interface Interval {
  source: string;
  start: string;
  end: string;
  seconds: number;
  /** Seconds into the recording, or null when the logger did not see the stream start. */
  offset: number | null;
}

export interface Report {
  kind: 'delivery-report' | 'airtime-report';
  creator: string;
  /** The sponsor, for a delivery report; null for an airtime report. */
  sponsor: string | null;
  dealId: string | null;
  label: string | null;
  platform: string;
  sources: string[];
  intervals: Interval[];
  totalSeconds: number;
  disagreements: number;
  openSince: string | null;
  startObserved: boolean;
  canvases: number | null;
  vodUrl: string;
  reportedAt: string;
  publicKey: string;
}

export interface Receipt {
  kind: 'receipt';
  serial: string;
  dealId: string;
  creator: string;
  sponsor: string;
  usageRights: string;
  /** Days of paid use licensed; null is unlimited. */
  paidUsageDays: number | null;
  sealedOn: string;
  sealedSha256: string;
  publicKey: string;
}

export type Document = Report | Receipt | { kind: 'unknown'; reason: string };

type Obj = Record<string, unknown>;

const str = (o: Obj, key: string): string => (typeof o[key] === 'string' ? (o[key] as string) : '');
const num = (o: Obj, key: string): number => (typeof o[key] === 'number' ? (o[key] as number) : 0);
const strOrNull = (o: Obj, key: string): string | null => (typeof o[key] === 'string' ? (o[key] as string) : null);

function interval(value: unknown): Interval | null {
  if (typeof value !== 'object' || value === null) return null;
  const o = value as Obj; // narrowed field by field
  const offset = o.streamOffsetSeconds;
  return { source: str(o, 'source'), start: str(o, 'start'), end: str(o, 'end'), seconds: num(o, 'seconds'),
    offset: typeof offset === 'number' ? offset : null };
}

function report(o: Obj, kind: Report['kind']): Report {
  const intervals = Array.isArray(o.intervals) ? o.intervals.map(interval).filter((i): i is Interval => i !== null) : [];
  return {
    kind,
    creator: str(o, 'creator'),
    sponsor: kind === 'delivery-report' ? str(o, 'sponsor') : null,
    dealId: strOrNull(o, 'dealId'),
    label: strOrNull(o, 'label'),
    platform: str(o, 'platform'),
    sources: Array.isArray(o.sources) ? o.sources.filter((s): s is string => typeof s === 'string') : [],
    intervals,
    totalSeconds: num(o, 'totalSeconds'),
    disagreements: num(o, 'disagreements'),
    openSince: strOrNull(o, 'openSince'),
    startObserved: o.startObserved === true,
    canvases: typeof o.canvases === 'number' ? o.canvases : null,
    vodUrl: str(o, 'vodUrl'),
    reportedAt: str(o, 'reportedAt'),
    publicKey: str(o, 'publicKey'),
  };
}

function receipt(o: Obj): Receipt {
  const days = o.paidUsageDays;
  return {
    kind: 'receipt',
    serial: str(o, 'serial'),
    dealId: str(o, 'dealId'),
    creator: str(o, 'creator'),
    sponsor: str(o, 'sponsor'),
    usageRights: str(o, 'usageRights'),
    paidUsageDays: typeof days === 'number' ? days : null,
    sealedOn: str(o, 'sealedOn'),
    sealedSha256: str(o, 'sealedSha256'),
    publicKey: str(o, 'publicKey'),
  };
}

/** Which document these bytes are, read for display. */
export function readDocument(bytes: Bytes): Document {
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return { kind: 'unknown', reason: 'it is not a JSON document from Sponsifer' };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) return { kind: 'unknown', reason: 'it is not a Sponsifer document' };
  const o = data as Obj; // narrowed field by field in report() and receipt()
  if (o.kind === 'delivery-report' || o.kind === 'airtime-report') return report(o, o.kind);
  if (typeof o.serial === 'string' && typeof o.sealedSha256 === 'string') return receipt(o);
  return { kind: 'unknown', reason: 'it is neither a report nor a licence receipt' };
}

/** A span of seconds as people read one: 1h 02m 03s, 4m 05s, 9s. */
export function span(seconds: number): string {
  const whole = Math.round(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`;
  return m > 0 ? `${m}m ${pad(s)}s` : `${s}s`;
}

const TWITCH = new Set(['twitch.tv', 'www.twitch.tv', 'm.twitch.tv']);
const YOUTUBE = new Set(['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be']);

/**
 * The recording opened at an offset, for the platforms whose links take one.
 * Null for anything else, or any address that is not https: the page links
 * only where it knows what the link does.
 */
export function recordingAt(vodUrl: string, offset: number): string | null {
  let url: URL;
  try {
    url = new URL(vodUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'https:') return null;
  const whole = Math.max(0, Math.floor(offset));
  if (TWITCH.has(url.hostname) && url.pathname.startsWith('/videos/')) {
    url.searchParams.set('t', `${Math.floor(whole / 3600)}h${Math.floor((whole % 3600) / 60)}m${whole % 60}s`);
    return url.toString();
  }
  if (YOUTUBE.has(url.hostname)) {
    url.searchParams.set('t', `${whole}s`);
    return url.toString();
  }
  return null;
}
