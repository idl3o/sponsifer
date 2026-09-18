import { useStore as useZustand } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { workspaceOf, type Workspace, type WorkspaceSlices } from '../domain/workspace';
import {
  fetchRemote,
  fetchWorkspacePath,
  putRemote,
  type Fetch,
  type Precondition,
  type Remote,
} from './workspaceClient';

/**
 * Keeps the store and the workspace file in step.
 *
 * The file is the source of truth: the OBS overlay and the CLI read and write
 * it too. On start the app reads the file and adopts it. Each edit is written
 * back after a short pause, as a compare-and-swap on the revision last read,
 * so a seal written by the CLI in the meantime is never overwritten: the write
 * is refused, the file is reloaded, and the creator is told.
 *
 * Three rules keep a creator's work from being lost:
 * - A file that cannot be read is never written automatically. Importing a
 *   file replaces it, and the server copies the old one aside first.
 * - With no server the app runs from this browser's copy alone, as it always
 *   has, and does not reconnect mid-session: a server that appeared later
 *   would otherwise replace the edits made meanwhile.
 * - The revision this browser last saw is remembered. If the file has not
 *   moved since, this browser's copy is at least as new, and it is written up
 *   rather than replaced, so edits made while the server was down survive.
 */

export type SyncMode = 'connecting' | 'file' | 'browser-only' | 'unreadable';

export interface SyncStatus {
  mode: SyncMode;
  /** Where the server keeps the file. */
  path: string;
  /** Why the file cannot be read, when the mode is `unreadable`. */
  reason: string;
  /** Something the creator should know about the last sync, or null. */
  notice: string | null;
  /** After an explicit import, replace an unreadable file with it. Does nothing otherwise. */
  adoptImport: () => void;
}

/** The sync's state, for the status line. Starts as browser-only, which is what the app is without `startSync`. */
export const syncStatus = createStore<SyncStatus>(() => ({
  mode: 'browser-only',
  path: '',
  reason: '',
  notice: null,
  adoptImport: () => undefined,
}));

/** Read the sync status from a component. */
export function useSyncStatus<T>(select: (status: SyncStatus) => T): T {
  return useZustand(syncStatus, select);
}

/** What the sync needs from the app's store. */
export interface SyncTarget extends WorkspaceSlices {
  importAll: (workspace: Workspace) => void;
}

export interface SyncedStore {
  getState: () => SyncTarget;
  subscribe: (listener: (state: SyncTarget, previous: SyncTarget) => void) => () => void;
}

/** The side effects the sync uses, passed in so it can be tested without a browser. */
export interface SyncEnv {
  fetch: Fetch;
  /** Call back when the creator comes back to the app. Returns a function that stops listening. */
  onReturn: (callback: () => void) => () => void;
  /** Where the last revision seen is remembered: this browser's localStorage. */
  storage?: Pick<Storage, 'getItem' | 'setItem'> | undefined;
  debounceMs?: number;
  pollMs?: number;
}

/** The localStorage key holding the revision this browser last read or wrote. */
export const SEEN_KEY = 'sponsifable-sync-revision';

const SLICES = ['profile', 'terms', 'prospects', 'deals', 'board', 'emblem'] as const;

interface Session {
  store: SyncedStore;
  env: SyncEnv;
  etag: string | null;
  applying: boolean;
  dirty: boolean;
  writing: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  stopped: boolean;
}

const status = (patch: Partial<SyncStatus>) => syncStatus.setState(patch);
const mode = () => syncStatus.getState().mode;

function remember(s: Session, etag: string | null): void {
  s.etag = etag;
  try {
    if (etag) s.env.storage?.setItem(SEEN_KEY, etag);
  } catch {
    // Storage blocked. The next start will adopt the file rather than write up.
  }
}

function lastSeen(s: Session): string | null {
  try {
    return s.env.storage?.getItem(SEEN_KEY) ?? null;
  } catch {
    return null;
  }
}

function apply(s: Session, workspace: Workspace, etag: string): void {
  s.applying = true;
  try {
    s.store.getState().importAll(workspace);
  } finally {
    s.applying = false;
  }
  remember(s, etag);
}

/** Write the store to the file, then again for any edits made during the write. */
async function flush(s: Session): Promise<void> {
  if (s.writing || s.stopped) return;
  s.writing = true;
  try {
    while (s.dirty && mode() === 'file' && !s.stopped) {
      s.dirty = false;
      await writeOnce(s, false);
    }
  } finally {
    s.writing = false;
  }
}

async function writeOnce(s: Session, replaceUnreadable: boolean): Promise<boolean> {
  const precondition: Precondition = s.etag ? { ifMatch: s.etag } : { create: true };
  const result = await putRemote(s.env.fetch, workspaceOf(s.store.getState()), precondition, replaceUnreadable);
  if (s.stopped) return false;
  switch (result.kind) {
    case 'ok':
      remember(s, result.etag);
      status({ mode: 'file', reason: '', notice: null });
      return true;
    case 'conflict':
      await reloadAfterConflict(s);
      return false;
    case 'refused':
      status({ notice: `Not saved to the file: ${result.reason}.` });
      return false;
    case 'offline':
      status({
        mode: 'browser-only',
        notice: 'The server stopped. Edits are kept in this browser, and reach the file when you restart `sponsifable serve` and reload.',
      });
      return false;
  }
}

async function reloadAfterConflict(s: Session): Promise<void> {
  s.dirty = false;
  const remote = await fetchRemote(s.env.fetch, null);
  if (s.stopped) return;
  await adopt(s, remote);
  if (remote.kind === 'ok') {
    status({ notice: 'The workspace changed on disk, perhaps a seal or a verify, and was reloaded. Check your last edit.' });
  }
}

/** Act on a fresh read of the file. */
async function adopt(s: Session, remote: Remote): Promise<void> {
  switch (remote.kind) {
    case 'ok':
      apply(s, remote.workspace, remote.etag);
      status({ mode: 'file', reason: '' });
      return;
    case 'missing':
      s.etag = null;
      s.dirty = true;
      status({ mode: 'file', reason: '' });
      return flush(s);
    case 'unreadable':
      s.etag = remote.etag;
      status({ mode: 'unreadable', reason: remote.reason });
      return;
    case 'offline':
      status({ mode: 'browser-only' });
      return;
    case 'unchanged':
      return;
  }
}

/** True when the file has not moved since this browser last saw it, and this browser holds something else. */
function browserIsNewer(s: Session, remote: Extract<Remote, { kind: 'ok' }>): boolean {
  if (lastSeen(s) !== remote.etag) return false;
  return JSON.stringify(workspaceOf(s.store.getState())) !== JSON.stringify(remote.workspace);
}

async function connect(s: Session): Promise<void> {
  status({ mode: 'connecting', notice: null });
  const remote = await fetchRemote(s.env.fetch, null);
  if (s.stopped) return;
  if (remote.kind === 'ok' && browserIsNewer(s, remote)) {
    s.etag = remote.etag;
    s.dirty = true;
    status({ mode: 'file', reason: '' });
    await flush(s);
  } else {
    await adopt(s, remote.kind === 'unchanged' ? { kind: 'offline' } : remote);
  }
  if (mode() !== 'browser-only') status({ path: await fetchWorkspacePath(s.env.fetch) });
}

/** Look for changes made on disk. Skipped while an edit is waiting, whose write will compare and swap. */
async function refresh(s: Session): Promise<void> {
  const current = mode();
  if (s.stopped || s.writing || s.dirty || s.timer || (current !== 'file' && current !== 'unreadable')) return;
  const remote = await fetchRemote(s.env.fetch, s.etag);
  if (s.stopped || s.writing || s.dirty) return;
  await adopt(s, remote);
}

function schedule(s: Session): void {
  if (s.timer) clearTimeout(s.timer);
  s.timer = setTimeout(() => {
    s.timer = null;
    void flush(s);
  }, s.env.debounceMs ?? 400);
}

async function adoptImport(s: Session): Promise<void> {
  if (mode() !== 'unreadable') return;
  status({ mode: 'file' });
  if (!(await writeOnce(s, true)) && mode() === 'file') status({ mode: 'unreadable' });
}

/**
 * Start keeping `store` and the workspace file in step.
 * @returns a function that stops the sync.
 */
export function startSync(store: SyncedStore, env: SyncEnv): () => void {
  const s: Session = { store, env, etag: null, applying: false, dirty: false, writing: false, timer: null, stopped: false };
  const unsubscribe = store.subscribe((state, previous) => {
    if (s.applying || mode() !== 'file' || !SLICES.some((k) => state[k] !== previous[k])) return;
    s.dirty = true;
    schedule(s);
  });
  const poll = setInterval(() => void refresh(s), env.pollMs ?? 10_000);
  const stopReturn = env.onReturn(() => void refresh(s));
  status({ adoptImport: () => void adoptImport(s) });
  void connect(s);
  return () => {
    s.stopped = true;
    if (s.timer) clearTimeout(s.timer);
    clearInterval(poll);
    stopReturn();
    unsubscribe();
    status({ adoptImport: () => undefined });
  };
}
