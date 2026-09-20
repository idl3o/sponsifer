import type { OnAirSummary } from '../domain/onair';
import { parseWorkspace, type Workspace } from '../domain/workspace';

/**
 * The HTTP edge of the workspace file: one request per function, each turned
 * into a plain result. Nothing here decides what to do with the answer; that
 * is `sync.ts`. Everything goes to the page's own origin, which is either
 * `sponsifer serve` or Vite proxying to it. There is no other server.
 */

/** What reading the workspace file found. */
export type Remote =
  | { kind: 'ok'; workspace: Workspace; etag: string }
  | { kind: 'unchanged' }
  | { kind: 'missing' }
  | { kind: 'unreadable'; reason: string; etag: string | null }
  | { kind: 'offline' };

/** What writing it did. */
export type Written =
  | { kind: 'ok'; etag: string }
  | { kind: 'conflict' }
  | { kind: 'refused'; reason: string }
  | { kind: 'offline' };

/** The write's precondition: the revision last read, or that there is no file yet. */
export type Precondition = { ifMatch: string } | { create: true };

export type Fetch = typeof fetch;

const URL_WORKSPACE = '/api/workspace';

async function request(fetcher: Fetch, init?: RequestInit): Promise<Response | null> {
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
async function drain(response: Response): Promise<void> {
  try {
    await response.arrayBuffer();
  } catch {
    // Already consumed, or there was no body.
  }
}

async function errorOf(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { error?: unknown } | null;
  return typeof body?.error === 'string' ? body.error : `the server answered ${response.status}`;
}

/** A 200 that is really the workspace server, not a static host's fallback page. */
function isWorkspaceAnswer(response: Response): boolean {
  return (response.headers.get('Content-Type') ?? '').startsWith('application/json') && response.headers.has('ETag');
}

/** Read the workspace file. Pass the last ETag to be told when it has not changed. */
export async function fetchRemote(fetcher: Fetch, etag: string | null): Promise<Remote> {
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
  const data: unknown = await response.json().catch(() => undefined);
  const parsed = parseWorkspace(data);
  return parsed.ok
    ? { kind: 'ok', workspace: parsed.workspace, etag: tag }
    : { kind: 'unreadable', reason: parsed.error, etag: tag };
}

/**
 * Replace the workspace file, if it is still at the revision this app read.
 * `replaceUnreadable` asks the server to copy an unreadable file aside first.
 */
export async function putRemote(
  fetcher: Fetch,
  workspace: Workspace,
  precondition: Precondition,
  replaceUnreadable = false,
): Promise<Written> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if ('ifMatch' in precondition) headers['If-Match'] = precondition.ifMatch;
  else headers['If-None-Match'] = '*';
  if (replaceUnreadable) headers['X-Replace-Unreadable'] = '1';
  const response = await request(fetcher, { method: 'PUT', headers, body: JSON.stringify(workspace) });
  if (!response) return { kind: 'offline' };
  if (response.status === 409) {
    await drain(response);
    return { kind: 'conflict' };
  }
  const etag = response.headers.get('ETag');
  if (response.ok && etag) {
    await drain(response);
    return { kind: 'ok', etag };
  }
  if (response.status >= 500) {
    await drain(response);
    return { kind: 'offline' };
  }
  return { kind: 'refused', reason: await errorOf(response) };
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
