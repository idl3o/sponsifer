import { useState } from 'react';
import { setupSentence } from '../domain/obsSetup';
import { setupObs, type Fetch, type ObsSetup } from '../store/workspaceClient';
import { PasswordField } from './LoggerControl';
import { Button } from './ui/Primitives';

/**
 * Put this sponsor into OBS with one press: the server makes the conventional
 * sources that are missing, hidden, and points the ones that exist at this
 * deal. Nothing here touches OBS; it asks the server, and then says exactly
 * what was done, because a tool that changes someone's scenes owes them that.
 *
 * OBS's password is handled as the logger handles it: asked for only when OBS
 * asks, sent once, cleared, never stored.
 */
export function ObsSetupControl({ dealId, brand, fetcher }: { dealId: string; brand: string; fetcher: Fetch }) {
  const [outcome, setOutcome] = useState<ObsSetup | null>(null);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const run = () => {
    setBusy(true);
    void setupObs(fetcher, dealId, password).then((result) => {
      setOutcome(result);
      setBusy(false);
    });
    setPassword('');
  };
  const said =
    outcome === null ? null
    : outcome.kind === 'ok' ? setupSentence(outcome.result)
    : outcome.kind === 'offline' ? 'Sponsifer is not answering.'
    : `Nothing was changed: ${outcome.reason}`;
  return (
    <div className="obs-setup">
      {outcome?.kind === 'obs' && outcome.needsPassword && <PasswordField value={password} onChange={setPassword} />}
      <div className="row" style={{ marginBottom: 8 }}>
        <Button
          disabled={busy}
          title="Makes the sponsor's sources in OBS if they are missing, hidden, and points the ones that exist at this deal. It never removes, shows or hides anything."
          onClick={run}
        >
          {busy ? 'Asking OBS' : `Put ${brand || 'this sponsor'} into OBS`}
        </Button>
      </div>
      {said && (
        <p className="note" role="status">
          {said}
        </p>
      )}
    </div>
  );
}
