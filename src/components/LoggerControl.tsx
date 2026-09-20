import { useCallback, useEffect, useState } from 'react';
import { loggerSentence, type LoggerStatus } from '../domain/onair';
import { fetchLogger, startLogger, stopLogger, type Fetch, type Logger } from '../store/workspaceClient';
import { Button } from './ui/Primitives';

export interface LoggerState {
  /** The logger as last heard, or null while unknown or when this server has none. */
  status: LoggerStatus | null;
  /** Why the server would not act on the last request. The status above still stands. */
  refusal: string | null;
  busy: boolean;
  /** Send a start or a stop, then show what the server answered. */
  act: (request: Promise<Logger>) => void;
}

/**
 * The server's logger, as last heard. It is read when first shown, after each
 * action, when the window regains focus, and whenever `refreshKey` moves. The
 * app passes no key and so runs no timer; the OBS dock, which nobody focuses,
 * passes its poll's tick.
 */
export function useLogger(fetcher: Fetch, onChanged: () => void, refreshKey = 0): LoggerState {
  const [status, setStatus] = useState<LoggerStatus | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const take = useCallback((result: Logger) => {
    if (result.kind === 'ok' || result.kind === 'obs') setStatus(result.status);
    // A refusal leaves the logger as it was, so the control stays and can be tried again.
    else if (result.kind !== 'refused') setStatus(null);
  }, []);

  useEffect(() => {
    const refresh = () => void fetchLogger(fetcher).then(take);
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [fetcher, take, refreshKey]);

  const act = (request: Promise<Logger>) => {
    setBusy(true);
    void request.then((result) => {
      take(result);
      // Only an action sets or clears the refusal, so a later reread does not wipe what the creator was told.
      setRefusal(result.kind === 'refused' ? result.reason : null);
      setBusy(false);
      onChanged();
    });
  };
  return { status, refusal, busy, act };
}

export function PasswordField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <label className="field">
      <span className="lbl">OBS WebSocket password</span>
      <input type="password" autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} />
      <span className="hint">
        Under Tools, WebSocket Server Settings, in OBS. It goes to OBS on this machine and is not kept.
      </span>
    </label>
  );
}

/**
 * The logger's sentence, its password field when OBS asks for one, and the
 * Start or Stop button. OBS's password lives in this input until the request
 * is sent and is then cleared: it is never put in the store, the workspace or
 * browser storage.
 */
export function LoggerPanel({ dealId, fetcher, logger }: { dealId: string; fetcher: Fetch; logger: LoggerState }) {
  const [password, setPassword] = useState('');
  const { status, refusal, busy, act } = logger;
  if (!status) return null;

  const mine = status.deal === dealId;
  const start = () => {
    act(startLogger(fetcher, dealId, password));
    setPassword('');
  };
  return (
    <div className="logger">
      <p className="note" role="status">
        {refusal ? `Not started: ${refusal}.` : loggerSentence(status, dealId)}
      </p>
      {status.needsPassword && mine && !status.running && <PasswordField value={password} onChange={setPassword} />}
      <div className="row" style={{ marginBottom: 8 }}>
        {status.running && mine ? (
          <Button disabled={busy} onClick={() => act(stopLogger(fetcher))}>
            {busy ? 'Stopping' : 'Stop logging'}
          </Button>
        ) : (
          <Button variant="primary" disabled={busy || (status.running && !mine)} onClick={start}>
            {busy ? 'Asking OBS' : 'Start logging'}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Start and stop the on-air logger for a won deal from the app, without a second terminal. */
export function LoggerControl({ dealId, onChanged }: { dealId: string; onChanged: () => void }) {
  const [fetcher] = useState<Fetch>(() => window.fetch.bind(window));
  const logger = useLogger(fetcher, onChanged);
  return <LoggerPanel dealId={dealId} fetcher={fetcher} logger={logger} />;
}
