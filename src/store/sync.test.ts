import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { DEFAULT_BOARD } from '../domain/board';
import { DEFAULT_EMBLEM } from '../domain/emblem';
import { DEFAULT_TERMS } from '../domain/pricing';
import { workspaceOf, type Workspace } from '../domain/workspace';
import { SAMPLE_PROFILE, SAMPLE_PROSPECTS } from './sample';
import { SEEN_KEY, startSync, syncStatus, type SyncTarget } from './sync';

/**
 * The sync against an in-memory stand-in for `sponsifer serve`, which keeps
 * the same rules: an ETag per revision, compare-and-swap writes, 404 with
 * `missing` when there is no file, 422 when the file is not JSON.
 */

const SAMPLE: Workspace = workspaceOf({
  profile: SAMPLE_PROFILE,
  terms: DEFAULT_TERMS,
  prospects: SAMPLE_PROSPECTS,
  deals: [],
  board: DEFAULT_BOARD,
  emblem: DEFAULT_EMBLEM,
});

const named = (name: string): Workspace => ({ ...SAMPLE, profile: { ...SAMPLE.profile, name } });

interface Put {
  headers: Headers;
  body: Workspace;
}

function fakeServer(initial: Workspace | string | null) {
  const state = {
    file: initial === null ? null : typeof initial === 'string' ? initial : JSON.stringify(initial),
    rev: 1,
    offline: false,
    puts: [] as Put[],
  };
  const etag = () => `"r${state.rev}"`;
  const json = (status: number, data: unknown, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });

  const put = (headers: Headers, body: string) => {
    state.puts.push({ headers, body: JSON.parse(body) as Workspace });
    const ifMatch = headers.get('If-Match');
    const fresh = headers.get('If-None-Match') === '*';
    if ((fresh && state.file !== null) || (!fresh && ifMatch !== etag())) return json(409, { error: 'changed' });
    state.file = body;
    state.rev += 1;
    return json(200, { revision: etag() }, { ETag: etag() });
  };

  const get = (headers: Headers) => {
    if (state.file === null) return json(404, { missing: true });
    if (headers.get('If-None-Match') === etag()) return new Response(null, { status: 304 });
    try {
      JSON.parse(state.file);
    } catch {
      return json(422, { error: 'the workspace file is not valid JSON' }, { ETag: etag() });
    }
    return new Response(state.file, { status: 200, headers: { 'Content-Type': 'application/json', ETag: etag() } });
  };

  const sent: Response[] = [];
  const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (state.offline) throw new TypeError('Failed to fetch');
    const answer =
      url === '/api/info'
        ? json(200, { workspacePath: '/home/ada/.sponsifer/workspace.json' })
        : init?.method === 'PUT'
          ? put(new Headers(init.headers), String(init.body))
          : get(new Headers(init?.headers));
    sent.push(answer);
    return answer;
  });

  /** Something other than the app, such as `sponsifer seal`, writes the file. */
  const cliWrites = (workspace: Workspace) => {
    state.file = JSON.stringify(workspace);
    state.rev += 1;
  };
  const saved = () => (state.file === null ? null : (JSON.parse(state.file) as Workspace));
  /** Every answer sent, so a test can check none was left with its body unread. */
  const leftOpen = () => sent.filter((r) => r.body !== null && !r.bodyUsed).length;
  return { state, fetch, cliWrites, saved, etag, leftOpen };
}

function makeStore(start: Workspace = SAMPLE): StoreApi<SyncTarget> {
  return createStore<SyncTarget>((set) => ({
    ...start,
    importAll: (ws) =>
      set({ profile: ws.profile, terms: ws.terms, prospects: ws.prospects, deals: ws.deals, board: ws.board, emblem: ws.emblem }),
  }));
}

const rename = (store: StoreApi<SyncTarget>, name: string) =>
  store.setState({ profile: { ...store.getState().profile, name } });

let stop: () => void = () => undefined;
let comeBack: () => void = () => undefined;

function sync(store: StoreApi<SyncTarget>, server: ReturnType<typeof fakeServer>, seen: Record<string, string> = {}) {
  const storage = {
    getItem: (key: string) => seen[key] ?? null,
    setItem: (key: string, value: string) => void (seen[key] = value),
  };
  stop = startSync(store, {
    fetch: server.fetch as unknown as typeof fetch,
    onReturn: (callback) => {
      comeBack = callback;
      return () => undefined;
    },
    storage,
    debounceMs: 400,
    pollMs: 1e9,
  });
  return seen;
}

/** Let every pending promise and due timer run. */
async function settle(ms = 0): Promise<void> {
  for (let i = 0; i < 6; i += 1) await vi.advanceTimersByTimeAsync(i === 0 ? ms : 0);
}

beforeEach(() => {
  vi.useFakeTimers();
  syncStatus.setState({ mode: 'browser-only', path: '', reason: '', notice: null });
});

afterEach(() => {
  stop();
  vi.useRealTimers();
});

describe('starting', () => {
  it('adopts the file, which wins over this browser', async () => {
    const server = fakeServer(named('From the file'));
    const store = makeStore(named('From this browser'));
    sync(store, server);
    await settle();
    expect(store.getState().profile.name).toBe('From the file');
    expect(syncStatus.getState()).toMatchObject({ mode: 'file', path: '/home/ada/.sponsifer/workspace.json' });
    expect(server.state.puts).toHaveLength(0);
  });

  it('creates a missing file from this browser, once, and only if there is still no file', async () => {
    const server = fakeServer(null);
    sync(makeStore(named('Ada, before the file existed')), server);
    await settle();
    expect(server.state.puts).toHaveLength(1);
    expect(server.state.puts[0]?.headers.get('If-None-Match')).toBe('*');
    expect(server.saved()?.profile.name).toBe('Ada, before the file existed');
  });

  it('runs from this browser alone when there is no server, and writes nothing', async () => {
    const server = fakeServer(SAMPLE);
    server.state.offline = true;
    const store = makeStore();
    sync(store, server);
    await settle();
    rename(store, 'Offline edit');
    await settle(1000);
    expect(syncStatus.getState().mode).toBe('browser-only');
    server.state.offline = false;
    comeBack();
    await settle(1000);
    expect(server.state.puts).toHaveLength(0);
    expect(store.getState().profile.name).toBe('Offline edit');
  });

  it('writes this browser up when the file has not moved since this browser last saw it', async () => {
    const server = fakeServer(named('As last synced'));
    const store = makeStore(named('Edited while the server was down'));
    sync(store, server, { [SEEN_KEY]: server.etag() });
    await settle();
    expect(store.getState().profile.name).toBe('Edited while the server was down');
    expect(server.saved()?.profile.name).toBe('Edited while the server was down');
  });

  it('adopts the file when it has moved since this browser last saw it', async () => {
    const server = fakeServer(named('Sealed from the terminal'));
    const store = makeStore(named('Older browser copy'));
    sync(store, server, { [SEEN_KEY]: '"r0"' });
    await settle();
    expect(store.getState().profile.name).toBe('Sealed from the terminal');
  });
});

describe('writing', () => {
  it('writes edits after a pause, as one compare-and-swap on the revision read', async () => {
    const server = fakeServer(SAMPLE);
    const store = makeStore();
    const seen = sync(store, server);
    await settle();
    const read = server.etag();
    rename(store, 'Ada T');
    rename(store, 'Ada Trelawny-Smith');
    await settle(100);
    expect(server.state.puts).toHaveLength(0);
    await settle(400);
    expect(server.state.puts).toHaveLength(1);
    expect(server.state.puts[0]?.headers.get('If-Match')).toBe(read);
    expect(server.saved()?.profile.name).toBe('Ada Trelawny-Smith');
    expect(seen[SEEN_KEY]).toBe(server.etag());
  });

  it('does not write back what it has just read', async () => {
    const server = fakeServer(named('From the file'));
    sync(makeStore(), server);
    await settle(1000);
    expect(server.state.puts).toHaveLength(0);
  });

  it('never overwrites a change made on disk: it reloads and says so', async () => {
    const server = fakeServer(SAMPLE);
    const store = makeStore();
    sync(store, server);
    await settle();
    server.cliWrites(named('Sealed by the CLI'));
    rename(store, 'A late edit');
    await settle(500);
    expect(server.saved()?.profile.name).toBe('Sealed by the CLI');
    expect(store.getState().profile.name).toBe('Sealed by the CLI');
    expect(syncStatus.getState().notice).toMatch(/changed on disk/);
  });

  it('leaves no response body unread, which would hold the request open', async () => {
    const server = fakeServer(SAMPLE);
    const store = makeStore();
    sync(store, server);
    await settle();
    rename(store, 'An edit');
    await settle(500);
    server.cliWrites(named('Sealed by the CLI'));
    rename(store, 'A late edit');
    await settle(500);
    expect(server.state.puts.length).toBeGreaterThan(1);
    expect(server.leftOpen()).toBe(0);
  });

  it('falls back to this browser, and says so, when the server stops', async () => {
    const server = fakeServer(SAMPLE);
    const store = makeStore();
    sync(store, server);
    await settle();
    server.state.offline = true;
    rename(store, 'Edit after the server stopped');
    await settle(500);
    expect(syncStatus.getState().mode).toBe('browser-only');
    expect(syncStatus.getState().notice).toMatch(/server stopped/);
  });
});

describe('reading changes made elsewhere', () => {
  it('picks up a seal when the creator comes back to the app', async () => {
    const server = fakeServer(SAMPLE);
    const store = makeStore();
    sync(store, server);
    await settle();
    server.cliWrites(named('After a seal'));
    comeBack();
    await settle(1000);
    expect(store.getState().profile.name).toBe('After a seal');
    expect(server.state.puts).toHaveLength(0); // what was just read is not written back
  });

  it('asks only whether the file changed, and changes nothing when it has not', async () => {
    const server = fakeServer(SAMPLE);
    const store = makeStore();
    sync(store, server);
    await settle();
    const before = store.getState().profile;
    comeBack();
    await settle();
    expect(store.getState().profile).toBe(before);
  });
});

describe('an unreadable file', () => {
  it('is never written automatically', async () => {
    const server = fakeServer('{ not json');
    const store = makeStore();
    sync(store, server);
    await settle();
    expect(syncStatus.getState()).toMatchObject({ mode: 'unreadable' });
    rename(store, 'An edit');
    await settle(1000);
    expect(server.state.puts).toHaveLength(0);
    expect(server.state.file).toBe('{ not json');
  });

  it('counts a file the app cannot parse as unreadable, with the reason', async () => {
    const server = fakeServer(JSON.stringify({ version: 4, profile: { niche: 'astrology' }, prospects: [] }));
    sync(makeStore(), server);
    await settle();
    expect(syncStatus.getState().mode).toBe('unreadable');
    expect(syncStatus.getState().reason).toMatch(/profile/);
  });

  it('is replaced by an explicit import, which asks the server to set it aside', async () => {
    const server = fakeServer('{ not json');
    const store = makeStore();
    sync(store, server);
    await settle();
    store.getState().importAll(named('Imported'));
    syncStatus.getState().adoptImport();
    await settle();
    const [write] = server.state.puts;
    expect(write?.headers.get('X-Replace-Unreadable')).toBe('1');
    expect(write?.headers.get('If-Match')).toBe('"r1"');
    expect(server.saved()?.profile.name).toBe('Imported');
    expect(syncStatus.getState().mode).toBe('file');
  });
});
