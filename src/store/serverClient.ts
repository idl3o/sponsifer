import { parseObsSetup, type ObsSetupResult } from '../domain/obsSetup';
import { parseLoggerStatus, type LoggerStatus, type OnAirSummary } from '../domain/onair';
import { parseStage, type Stage } from '../domain/stage';

/**
 * The HTTP edge of the local server, for every page it serves: one request per
 * function, each turned into a plain result. Everything goes to the page's own
 * origin, which is either `sponsifer app` or Vite proxying to it.
 *
 * Nothing here imports the full workspace parser, so the overlay and the dock,
 * which read only the stream's part of the file, never load the pricing
 * engine. `workspaceClient.ts` adds the whole file's read and write for the app.
 */

export type Fetch = typeof fetch;

const URL_WORKSPACE = '/api/workspace';

export async function request(fetcher: Fetch, init?: RequestInit): Promise<Response | null> {
  try {
    return await fetcher(URL_WORKSPACE, { cache: 'no-store', ...init });
  } catch {
    return null;
  }
}

/**
 * Read to the end a body this code has no use for.
 *
 * A fetch settles as soon as the headers arrive, but the browser holds the
 * request open until the body is finished. Left undone, every write leaks a
 * connection in a browser that stays open for a whole stream. These bodies are
 * a few bytes of JSON, and reading them lets the request finish; cancelling
 * would abort it instead, which shows up as a failed request.
 */
export async function drain(response: Response): Promise<void> {
  try {
    await response.arrayBuffer();
  } catch {
    // Already consumed, or there was no body.
  }
}

export async function errorOf(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === 'string' ? body.error : `the server answered ${response.status}`;
}

/** A 200 that is really the workspace server, not a static host's fallback page. */
function isWorkspaceAnswer(response: Response): boolean {
  return (response.headers.get('Content-Type') ?? '').startsWith('application/json') && response.headers.has('ETag');
}

/** What reading the workspace file found, parsed as `T`. */
export type FileRead<T> =
  | { kind: 'ok'; value: T; etag: string }
  | { kind: 'unchanged' }
  | { kind: 'missing' }
  | { kind: 'unreadable'; reason: string; etag: string | null }
  | { kind: 'offline' };

export type Parse<T> = (data: unknown) => { ok: true; value: T } | { ok: false; error: string };

/** Read the workspace file through `parse`. Pass the last ETag to be told when it has not changed. */
export async function readFile<T>(fetcher: Fetch, etag: string | null, parse: Parse<T>): Promise<FileRead<T>> {
  const response = await request(fetcher, etag ? { headers: { 'If-None-Match': etag } } : undefined);
  if (!response) return { kind: 'offline' };
  if (response.status === 304) return { kind: 'unchanged' };
  if (response.status === 404) {
    const body = (await response.json().catch(() => null)) as { missing?: unknown } | null;
    return body?.missing === true ? { kind: 'missing' } : { kind: 'offline' };
  }
  if (response.status === 422) {
    return { kind: 'unreadable', reason: await errorOf(response), etag: response.headers.get('ETag') };
  }
  if (!response.ok || !isWorkspaceAnswer(response)) {
    await drain(response);
    return { kind: 'offline' };
  }
  const tag = response.headers.get('ETag') ?? '';
  const parsed = parse(await response.json().catch(() => undefined));
  return parsed.ok ? { kind: 'ok', value: parsed.value, etag: tag } : { kind: 'unreadable', reason: parsed.error, etag: tag };
}

const stageOf: Parse<Stage> = (data) => {
  const parsed = parseStage(data);
  return parsed.ok ? { ok: true, value: parsed.stage } : parsed;
};

/** Read only the stream's part of the file: the house style and the deals' art. What the overlay and the dock use. */
export function fetchStage(fetcher: Fetch, etag: string | null): Promise<FileRead<Stage>> {
  return readFile(fetcher, etag, stageOf);
}

/** What the on-air log says for a deal, as the server folds it. */
export type OnAir = { kind: 'ok'; summary: OnAirSummary } | { kind: 'missing' } | { kind: 'offline' };

/** Read the on-air summary for a deal. `missing` means no log has been written for it yet. */
export async function fetchOnAir(fetcher: Fetch, dealId: string): Promise<OnAir> {
  let response: Response;
  try {
    response = await fetcher(`/api/onair/${encodeURIComponent(dealId)}`, { cache: 'no-store' });
  } catch {
    return { kind: 'offline' };
  }
  if (response.status === 404) {
    await drain(response);
    return { kind: 'missing' };
  }
  if (!response.ok) {
    await drain(response);
    return { kind: 'offline' };
  }
  const summary = (await response.json().catch(() => null)) as OnAirSummary | null;
  return summary && Array.isArray(summary.intervals) ? { kind: 'ok', summary } : { kind: 'offline' };
}

/**
 * What came of asking the server about its on-air logger.
 *
 * `obs` is the server working and OBS saying no: not running, a password
 * wanted or refused, none of the sources present. The status carries the
 * reason. `unavailable` is a server that has no logger to run.
 */
export type Logger =
  | { kind: 'ok'; status: LoggerStatus }
  | { kind: 'obs'; status: LoggerStatus }
  | { kind: 'refused'; reason: string }
  | { kind: 'unavailable' }
  | { kind: 'offline' };

const URL_LOGGER = '/api/logger';

async function statusOf(response: Response, kind: 'ok' | 'obs'): Promise<Logger> {
  const status = parseLoggerStatus(await response.json().catch(() => null));
  return status ? { kind, status } : { kind: 'offline' };
}

/** Whether the logger is running, and for which deal. */
export async function fetchLogger(fetcher: Fetch): Promise<Logger> {
  let response: Response;
  try {
    response = await fetcher(URL_LOGGER, { cache: 'no-store' });
  } catch {
    return { kind: 'offline' };
  }
  if (response.ok) return statusOf(response, 'ok');
  await drain(response);
  return response.status === 404 ? { kind: 'unavailable' } : { kind: 'offline' };
}

async function postLogger(fetcher: Fetch, action: 'start' | 'stop', body: Record<string, string>): Promise<Logger> {
  let response: Response;
  try {
    response = await fetcher(`${URL_LOGGER}/${action}`, {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  } catch {
    return { kind: 'offline' };
  }
  if (response.ok) return statusOf(response, 'ok');
  if (response.status === 502) return statusOf(response, 'obs');
  return { kind: 'refused', reason: await errorOf(response) };
}

/**
 * Start logging a deal. The password goes in this one request to the server on
 * this machine, which hands it to OBS and keeps no copy; it is never stored here.
 */
export function startLogger(fetcher: Fetch, dealId: string, password = ''): Promise<Logger> {
  return postLogger(fetcher, 'start', password ? { deal: dealId, password } : { deal: dealId });
}

/** Stop the logger, whichever deal it is for. Safe when none is running. */
export function stopLogger(fetcher: Fetch): Promise<Logger> {
  return postLogger(fetcher, 'stop', {});
}

/**
 * What came of asking the server to put a deal into OBS. `obs` is the server
 * working and OBS saying no; `refused` is the server declining, for instance
 * because the logger is running.
 */
export type ObsSetup =
  | { kind: 'ok'; result: ObsSetupResult }
  | { kind: 'obs'; reason: string; needsPassword: boolean }
  | { kind: 'refused'; reason: string }
  | { kind: 'offline' };

/** Put a won deal's placements into OBS. The password is handled as `startLogger` handles it. */
export async function setupObs(fetcher: Fetch, dealId: string, password = ''): Promise<ObsSetup> {
  let response: Response;
  try {
    response = await fetcher('/api/obs/setup', {
      method: 'POST',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(password ? { deal: dealId, password } : { deal: dealId }),
    });
  } catch {
    return { kind: 'offline' };
  }
  if (response.ok) {
    const result = parseObsSetup(await response.json().catch(() => null));
    return result ? { kind: 'ok', result } : { kind: 'offline' };
  }
  if (response.status === 502) {
    const body = (await response.json().catch(() => null)) as { error?: unknown; needsPassword?: unknown } | null;
    const reason = typeof body?.error === 'string' ? body.error : 'OBS did not answer.';
    return { kind: 'obs', reason, needsPassword: body?.needsPassword === true };
  }
  return { kind: 'refused', reason: `${await errorOf(response)}.` };
}

/** Where the server keeps the file, for the status line. Empty when it cannot say. */
export async function fetchWorkspacePath(fetcher: Fetch): Promise<string> {
  try {
    const response = await fetcher('/api/info', { cache: 'no-store' });
    const info = (await response.json()) as { workspacePath?: unknown };
    return typeof info.workspacePath === 'string' ? info.workspacePath : '';
  } catch {
    return '';
  }
}
