import { parseWorkspace, type Workspace } from '../domain/workspace';
import { drain, errorOf, readFile, request, type Fetch, type Parse } from './serverClient';

/**
 * The HTTP edge of the workspace file, for the app: the whole file read and
 * checked, and written back. Nothing here decides what to do with the answer;
 * that is `sync.ts`. Everything goes to the page's own origin, which is either
 * `sponsifer app` or Vite proxying to it. There is no other server.
 *
 * The server's other calls live in `serverClient.ts`, without the workspace
 * parser, and are re-exported here for the app.
 */

export * from './serverClient';

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

const workspaceOf: Parse<Workspace> = (data) => {
  const parsed = parseWorkspace(data);
  return parsed.ok ? { ok: true, value: parsed.workspace } : parsed;
};

/** Read the workspace file. Pass the last ETag to be told when it has not changed. */
export async function fetchRemote(fetcher: Fetch, etag: string | null): Promise<Remote> {
  const read = await readFile(fetcher, etag, workspaceOf);
  return read.kind === 'ok' ? { kind: 'ok', workspace: read.value, etag: read.etag } : read;
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
