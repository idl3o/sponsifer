import { useEffect, useState } from 'react';
import { LoggerPanel, useLogger } from '../components/LoggerControl';
import { Pill } from '../components/ui/Primitives';
import {
  PLACEMENT_STATE_LABEL, dockDeals, dockView, pickDockDeal, type DockDeal, type DockPlacement, type PlacementState,
} from '../domain/dock';
import { clockOf, onAirSentence, placementSentence, reportSentence } from '../domain/onair';
import { fetchOnAir, fetchRemote, type Fetch, type OnAir } from '../store/workspaceClient';

/**
 * The deal panel, inside OBS.
 *
 * A custom browser dock is part of OBS's window, with storage of its own, so
 * like the overlay it reads the workspace through the local server. Unlike the
 * overlay it is not on stream, so it may speak when something is wrong, and it
 * may poll: nobody focuses a dock, and a panel whose job is to say what is on
 * air now is no use stale. It still draws no price, because OBS's window is
 * captured and shared more often than a streamer means it to be.
 *
 * It only reads, except for the logger's start and stop. It never writes the
 * workspace.
 */

interface Reading {
  /** Null until the server has answered once. */
  deals: DockDeal[] | null;
  /** False after a read that did not reach the server. */
  reached: boolean;
  /** Moves with every read, so everything else rereads in step. */
  tick: number;
}

const TONE: Record<PlacementState, 'plain' | 'good' | 'warn' | 'bad' | 'accent'> = {
  'on-air': 'good',
  'in-program': 'accent',
  watched: 'plain',
  'not-in-obs': 'warn',
  unknown: 'plain',
};

/** The workspace's streamable deals, read now and every `pollMs` while the dock is showing. */
function useReading(fetcher: Fetch, pollMs: number): Reading {
  const [reading, setReading] = useState<Reading>({ deals: null, reached: true, tick: 0 });

  useEffect(() => {
    let etag: string | null = null;
    let cancelled = false;
    const read = async () => {
      if (document.visibilityState === 'hidden') return;
      const remote = await fetchRemote(fetcher, etag);
      if (cancelled) return;
      if (remote.kind === 'ok') etag = remote.etag;
      setReading((was) => ({
        // An unchanged file keeps the deals already read; only a fresh read replaces them.
        deals: remote.kind === 'ok' ? dockDeals(remote.workspace) : remote.kind === 'missing' ? [] : was.deals,
        reached: remote.kind !== 'offline',
        tick: was.tick + 1,
      }));
    };
    void read();
    const timer = setInterval(() => void read(), pollMs);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [fetcher, pollMs]);
  return reading;
}

/** What the log adds up to for the chosen deal, reread on every tick. */
function useOnAir(fetcher: Fetch, dealId: string | null, tick: number): OnAir | null {
  const [onAir, setOnAir] = useState<OnAir | null>(null);
  useEffect(() => {
    if (!dealId) return;
    let cancelled = false;
    void fetchOnAir(fetcher, dealId).then((result) => {
      if (!cancelled) setOnAir(result);
    });
    return () => {
      cancelled = true;
    };
  }, [fetcher, dealId, tick]);
  return dealId ? onAir : null;
}

function PlacementRow({ placement }: { placement: DockPlacement }) {
  return (
    <li className="dock-placement">
      <span className="dock-placement-name">
        {placement.label}
        <span className="dock-source">{placement.sourceName}</span>
      </span>
      <Pill tone={TONE[placement.state]}>
        {PLACEMENT_STATE_LABEL[placement.state]}
        {placement.since ? ` since ${clockOf(placement.since)}` : ''}
      </Pill>
    </li>
  );
}

function LogLine({ onAir, dealId }: { onAir: OnAir | null; dealId: string }) {
  if (!onAir || onAir.kind !== 'ok') return null;
  return (
    <p className="note">
      {onAirSentence(onAir.summary)} {placementSentence(onAir.summary)} {reportSentence(onAir.summary, dealId)}
    </p>
  );
}

function Empty({ reached }: { reached: boolean }) {
  return reached ? (
    <p className="note dock-empty">No won deal waiting to be delivered. Record one in the app, and it appears here.</p>
  ) : (
    <p className="note dock-empty">
      Waiting for Sponsifer. Is <code>sponsifer serve</code> running?
    </p>
  );
}

export function Dock({ asked, fetcher, pollMs = 3000 }: { asked: string | null; fetcher: Fetch; pollMs?: number }) {
  const { deals, reached, tick } = useReading(fetcher, pollMs);
  const logger = useLogger(fetcher, () => undefined, tick);
  const [chosen, setChosen] = useState<string | null>(asked);
  const loggingDeal = logger.status?.running ? logger.status.deal : null;
  const dealId = deals ? pickDockDeal(deals, chosen, loggingDeal) : null;
  const deal = deals?.find((d) => d.id === dealId) ?? null;
  const onAir = useOnAir(fetcher, dealId, tick);

  if (!deals && reached) return null;
  if (!deals || !deal) return <Empty reached={reached} />;

  const view = dockView(deal, logger.status);
  return (
    <>
      <label className="field">
        <span className="lbl">Sponsor</span>
        {/* The logger holds one deal at a time, so the choice is fixed while it runs. */}
        <select value={deal.id} disabled={loggingDeal !== null} onChange={(e) => setChosen(e.target.value)}>
          {deals.map((d) => (
            <option key={d.id} value={d.id}>
              {d.brand} ({d.id})
            </option>
          ))}
        </select>
      </label>
      <p className={`dock-headline ${view.tone}`} role="status">
        {view.headline}
      </p>
      <ul className="dock-placements" aria-label="Placements">
        {view.placements.map((p) => (
          <PlacementRow key={p.kind} placement={p} />
        ))}
      </ul>
      <LoggerPanel dealId={deal.id} fetcher={fetcher} logger={logger} />
      <LogLine onAir={onAir} dealId={deal.id} />
      {!reached && <p className="note">Not reaching Sponsifer. This is the last it said.</p>}
    </>
  );
}
