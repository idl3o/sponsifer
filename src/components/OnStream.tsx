import { useEffect, useState } from 'react';
import { dockUrl } from '../domain/dock';
import { PLACEMENTS } from '../domain/emblem';
import { onAirSentence, placementSentence, reportSentence } from '../domain/onair';
import { overlayUrl } from '../domain/overlay';
import type { Deal } from '../domain/types';
import { useSyncStatus } from '../store/sync';
import { fetchOnAir, type OnAir } from '../store/workspaceClient';
import { LoggerControl } from './LoggerControl';
import { ObsSetupControl } from './ObsSetupControl';
import { EmblemEditor } from './emblem/EmblemEditor';
import { Button, copyText } from './ui/Primitives';

/**
 * A won deal on stream: the addresses OBS loads, the emblem's editor, the
 * logger, and what the log says. Shown on the deal's row and in the Ads tab,
 * from this one component, so the two cannot drift.
 */

/** Read the on-air log for a deal when its row is opened, and again when `tick` moves. Only the server can answer. */
function useOnAir(dealId: string, served: boolean, tick: number): OnAir | null {
  const [state, setState] = useState<OnAir | null>(null);
  useEffect(() => {
    if (!served) return;
    let cancelled = false;
    void fetchOnAir(window.fetch.bind(window), dealId).then((result) => {
      if (!cancelled) setState(result);
    });
    return () => {
      cancelled = true;
    };
  }, [dealId, served, tick]);
  return served ? state : null;
}

/** What the log says was on air, and whether a signed report exists yet. */
function OnAirLine({ deal, onAir }: { deal: Deal; onAir: OnAir | null }) {
  if (!onAir || onAir.kind === 'offline') return null;
  if (onAir.kind === 'missing') {
    return (
      <p className="note">
        No on-air log yet. Start logging before you go live, or run <code>sponsifer log {deal.id}</code> in a
        terminal. Either way OBS's WebSocket server must be switched on.
      </p>
    );
  }
  return (
    <p className="note">
      {onAirSentence(onAir.summary)} {placementSentence(onAir.summary)} {reportSentence(onAir.summary, deal.id)}
    </p>
  );
}

/**
 * The placements beyond the corner emblem, each its own OBS browser source.
 * The source name matters: `sponsifer log` finds each placement by it, which
 * is how the delivery report can say how long each one was on air.
 */
function OtherPlacements({ deal, served }: { deal: Deal; served: boolean }) {
  const [copied, setCopied] = useState('');
  return (
    <details className="placements">
      <summary>More placements: a lower third, a segment slate, a break card</summary>
      <p className="note">
        Add each as its own browser source, with the name shown, so the on-air log can tell them apart. The corner
        emblem's source is named "{PLACEMENTS[0]?.sourceName}".
      </p>
      {PLACEMENTS.filter((p) => p.value !== 'emblem').map((p) => (
        <div className="adj" key={p.value}>
          <div>{p.label}</div>
          <div className="f">
            <Button
              disabled={!served}
              onClick={() => void copyText(overlayUrl(window.location.origin, deal.id, p.value)).then((ok) => setCopied(ok ? p.value : ''))}
            >
              {copied === p.value ? 'Copied' : `Copy ${p.label.toLowerCase()} URL`}
            </Button>
          </div>
          <div className="why">
            {p.hint} Name the source "{p.sourceName}".
          </div>
        </div>
      ))}
    </details>
  );
}

/** The panel OBS can dock in its own window: what is on air now, and the logger's Start and Stop. */
function DockAddress({ served }: { served: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <p className="note">
      To work from inside OBS, add a dock: Docks, Custom Browser Docks, and paste this address. One dock serves
      every deal, and it shows no price.{' '}
      <Button disabled={!served} onClick={() => void copyText(dockUrl(window.location.origin)).then(setCopied)}>
        {copied ? 'Copied' : 'Copy dock URL'}
      </Button>
    </p>
  );
}

/** The OBS browser source that puts the emblem on stream, and what the log says about it. */
export function OnStream({ deal }: { deal: Deal }) {
  const served = useSyncStatus((s) => s.mode === 'file');
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const url = overlayUrl(window.location.origin, deal.id);
  // Moved each time the logger starts or stops, so the line below rereads the log.
  const [logTick, setLogTick] = useState(0);
  const onAir = useOnAir(deal.id, served, logTick);
  return (
    <>
      <h3>On stream</h3>
      <p className="note">
        Add this address to OBS as a browser source. It draws the sponsor's emblem with the Ad label,
        reads this workspace, and needs no OBS permissions.
      </p>
      <div className="row" style={{ marginBottom: 8 }}>
        <Button
          disabled={!served}
          title={served ? url : 'Needs `sponsifer serve`: OBS keeps its own browser storage, so the overlay reads the workspace file.'}
          onClick={() => void copyText(url).then(setCopied)}
        >
          {copied ? 'Copied' : 'Copy OBS URL'}
        </Button>
        <Button onClick={() => setEditing(!editing)}>{editing ? 'Close emblem' : 'Edit emblem'}</Button>
      </div>
      <OtherPlacements deal={deal} served={served} />
      {editing && <EmblemEditor deal={deal} />}
      {served && <ObsSetupControl dealId={deal.id} brand={deal.brand} fetcher={window.fetch.bind(window)} />}
      <DockAddress served={served} />
      {served && <LoggerControl dealId={deal.id} onChanged={() => setLogTick((n) => n + 1)} />}
      <OnAirLine deal={deal} onAir={onAir} />
    </>
  );
}
