import { useCallback, useEffect, useState } from 'react';
import { loggerSentence, type LoggerStatus } from '../domain/onair';
import { fetchLogger, startLogger, stopLogger, type Logger } from '../store/workspaceClient';
import { Button } from './ui/Primitives';

interface LoggerState {
  /** The logger as last heard, or null while unknown or when this server has none. */
  status: LoggerStatus | null;
  /** Why the server would not act on the last request. The status above still stands. */
  refusal: string | null;
  busy: boolean;
  /** Send a start or a stop, then show what the server answered. */
  act: (request: Promise<Logger>) => void;
}

/**
 * The server's logger, as last heard. There is no timer here: the status is
 * read when the row opens, after each action, and when the window regains
 * focus, which is when a creator who has been streaming comes back to look.
 */
function useLogger(onChanged: () => void): LoggerState {
  const [status, setStatus] = useState<LoggerStatus | null>(null);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const take = useCallback((result: Logger) => {
    if (result.kind === 'ok' || result.kind === 'obs') setStatus(result.status);
    else if (result.kind !== 'refused') setStatus(null);
    // A refusal leaves the logger as it was, so the control stays and can be tried again.
    setRefusal(result.kind === 'refused' ? result.reason : null);
  }, []);

  useEffect(() => {
    const refresh = () => void fetchLogger(window.fetch.bind(window)).then(take);
    refresh();
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [take]);

  const act = (request: Promise<Logger>) => {
    setBusy(true);
    void request.then((result) => {
      take(result);
      setBusy(false);
      onChanged();
    });
  };
  return { status, refusal, busy, act };
}

function PasswordField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
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
 * Start and stop the on-air logger for a won deal, without a second terminal.
 *
 * The server runs the logger; this only asks. OBS's password, when it wants
 * one, lives in this input until the request is sent and is then cleared: it is
 * never put in the store, the workspace or browser storage.
 */
export function LoggerControl({ dealId, onChanged }: { dealId: string; onChanged: () => void }) {
  const { status, refusal, busy, act } = useLogger(onChanged);
  const [password, setPassword] = useState('');
  if (!status) return null;

  const mine = status.deal === dealId;
  const fetcher = window.fetch.bind(window);
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
