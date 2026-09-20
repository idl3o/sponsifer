import { useEffect, useState } from 'react';
import { FORMAT_LABEL, PLATFORM_LABEL } from '../domain/benchmarks';
import { priceOverrun, rateSubmissionUrl } from '../domain/deals';
import { dockUrl } from '../domain/dock';
import { PLACEMENTS } from '../domain/emblem';
import { onAirSentence, placementSentence, reportSentence } from '../domain/onair';
import { overlayUrl } from '../domain/overlay';
import type { Deal, Sighting } from '../domain/types';
import { useSyncStatus } from '../store/sync';
import { useStore } from '../store/useStore';
import { fetchOnAir, type OnAir } from '../store/workspaceClient';
import { LoggerControl } from './LoggerControl';
import { EmblemEditor } from './emblem/EmblemEditor';
import { Button, Pill, TextField, copyText, money } from './ui/Primitives';

const LOST_LABEL: Record<NonNullable<Deal['lostReason']>, string> = {
  budget: 'budget',
  timing: 'timing',
  'no-reply': 'no reply',
  'poor-fit': 'poor fit',
  'i-declined': 'I declined',
  other: 'other',
};

/** One sighting of the asset running as a paid ad, with the overrun it implies. */
function SightingLine({ deal, sighting }: { deal: Deal; sighting: Sighting }) {
  const removeSighting = useStore((s) => s.removeSighting);
  const [copied, setCopied] = useState(false);
  const overrun = priceOverrun(deal, sighting);

  return (
    <div className="adj">
      <div>
        {sighting.startedOn} to {sighting.seenOn}
        <div className="note">{sighting.source || 'No source recorded'}</div>
      </div>
      <div className="f">{overrun.owed > 0 ? money(overrun.owed) : 'in terms'}</div>
      <div className="why">
        <div className="row" style={{ gap: 6, marginBottom: 6 }}>
          {sighting.verified ? (
            <Pill tone="good">verified by sponsifer verify</Pill>
          ) : (
            <Pill tone="warn">not verified</Pill>
          )}
          <Pill>
            {overrun.daysRun} days run, {Number.isFinite(overrun.permitted) ? overrun.permitted : 'unlimited'}{' '}
            permitted
          </Pill>
        </div>
        {!sighting.verified && (
          <p style={{ margin: '0 0 6px' }}>
            The contract still supports this claim. Without a decoded watermark the sponsor can
            dispute that the footage is yours, and a watermark that failed to decode proves nothing
            either way.
          </p>
        )}
        {overrun.sentence && <p style={{ margin: '0 0 6px' }}>{overrun.sentence}</p>}
        <div className="row" style={{ gap: 6 }}>
          {overrun.sentence && (
            <Button onClick={() => void copyText(overrun.sentence).then(setCopied)}>
              {copied ? 'Copied' : 'Copy paragraph'}
            </Button>
          )}
          <Button variant="ghost" onClick={() => removeSighting(deal.id, sighting.id)}>
            Delete sighting
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Record a paid ad found running the asset. */
function SightingForm({ deal, today }: { deal: Deal; today: string }) {
  const addSighting = useStore((s) => s.addSighting);
  const [source, setSource] = useState('');
  const [startedOn, setStartedOn] = useState('');
  const [seenOn, setSeenOn] = useState(today);

  return (
    <div className="grid cols-3" style={{ alignItems: 'end' }}>
      <TextField label="Where you saw it" value={source} placeholder="Ad library link" onChange={setSource} />
      <TextField label="Started running" value={startedOn} placeholder="2026-10-01" onChange={setStartedOn} />
      <TextField label="Last seen running" value={seenOn} onChange={setSeenOn} />
      <Button
        onClick={() => {
          if (!startedOn || !seenOn) return;
          addSighting(deal.id, { source, startedOn, seenOn, verified: false });
          setSource('');
          setStartedOn('');
        }}
      >
        Record sighting
      </Button>
    </div>
  );
}

/** When the asset was delivered and when the invoice was paid. */
function DeliveryDates({ deal }: { deal: Deal }) {
  const updateDeal = useStore((s) => s.updateDeal);
  return (
    <div className="grid cols-2">
      <TextField
        label="Delivered on"
        value={deal.deliveredOn}
        placeholder="YYYY-MM-DD"
        onChange={(deliveredOn) => updateDeal(deal.id, { deliveredOn })}
        hint={deal.seal ? '' : 'Once this is set the deal can no longer be sealed.'}
      />
      <TextField
        label="Invoice paid on"
        value={deal.paidOn}
        placeholder="YYYY-MM-DD"
        onChange={(paidOn) => updateDeal(deal.id, { paidOn })}
      />
    </div>
  );
}

/** Whether the deal is sealed, and if not, whether it still can be. */
function RightsNote({ deal }: { deal: Deal }) {
  if (deal.seal) {
    return (
      <p className="note">
        <Pill tone="good">sealed</Pill> Serial {deal.seal.serial}, timestamped{' '}
        {deal.seal.timestampedAt}. Deliver the sealed file, not the original.
      </p>
    );
  }
  if (deal.deliveredOn) {
    return (
      <p className="note">
        Not sealed, and delivered, so it can no longer be. The contract is the evidence for this
        deal.
      </p>
    );
  }
  return (
    <p className="note">
      Not sealed. To establish rights, run <code>sponsifer seal {deal.id} your-file.png</code>{' '}
      before delivering. Sealing is optional and cannot be done after delivery.
    </p>
  );
}

/** The opt-in link that contributes a won deal's rounded figures to the benchmarks. */
function RateSubmission({ url }: { url: string }) {
  return (
    <>
      <h3>Help the benchmarks</h3>
      <p className="note">
        Opens the rate-data form on GitHub, filled in with rounded figures: no brand, no handle, no
        exact numbers or dates. The figures travel to GitHub in the page address as soon as it
        opens. Nothing is posted until you press submit there.
      </p>
      <a className="btn" href={url} target="_blank" rel="noopener noreferrer">
        Submit this rate anonymously
      </a>
    </>
  );
}

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
function OnStream({ deal }: { deal: Deal }) {
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
      <DockAddress served={served} />
      {served && <LoggerControl dealId={deal.id} onChanged={() => setLogTick((n) => n + 1)} />}
      <OnAirLine deal={deal} onAir={onAir} />
    </>
  );
}

/** Rights, delivery and sightings for a won deal. */
function WonDetail({ deal, today }: { deal: Deal; today: string }) {
  const submitUrl = rateSubmissionUrl(deal);
  return (
    <>
      <DeliveryDates deal={deal} />
      <OnStream deal={deal} />
      <h3>Rights</h3>
      <RightsNote deal={deal} />
      <h3>Sightings</h3>
      {deal.sightings.map((sighting) => (
        <SightingLine key={sighting.id} deal={deal} sighting={sighting} />
      ))}
      <SightingForm deal={deal} today={today} />
      {submitUrl && <RateSubmission url={submitUrl} />}
    </>
  );
}

/** The deal's headline: brand, outcome, badges, and what was agreed against the quote. */
function DealSummary({ deal }: { deal: Deal }) {
  const won = deal.outcome === 'won';
  const ratio = won && deal.quoted > 0 ? Math.round((deal.agreed / deal.quoted) * 100) : null;
  return (
    <div className="spread">
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 8 }}>
          <strong>{deal.brand || 'Unnamed brand'}</strong>
          <Pill tone={won ? 'good' : 'plain'}>
            {won ? 'won' : `lost: ${LOST_LABEL[deal.lostReason ?? 'other']}`}
          </Pill>
          {deal.seal && <Pill tone="accent">sealed</Pill>}
          {deal.sightings.length > 0 && <Pill tone="warn">{deal.sightings.length} sighted</Pill>}
        </div>
        <div className="note" style={{ marginTop: 3 }}>
          {FORMAT_LABEL[deal.format]} on {PLATFORM_LABEL[deal.platform]} · closed {deal.closedOn}
        </div>
      </div>
      <div style={{ textAlign: 'right', minWidth: 96 }}>
        <div className="price">{won ? money(deal.agreed) : '—'}</div>
        <div className="band">
          quoted {money(deal.quoted)}
          {ratio !== null ? ` · ${ratio}%` : ''}
        </div>
      </div>
    </div>
  );
}

/** One closed deal, expandable into delivery, rights and sightings. */
export function DealRow({ deal, today }: { deal: Deal; today: string }) {
  const [open, setOpen] = useState(false);
  const removeDeal = useStore((s) => s.removeDeal);
  const updateDeal = useStore((s) => s.updateDeal);
  const won = deal.outcome === 'won';

  return (
    <div className="prospect">
      <DealSummary deal={deal} />
      <div className="row" style={{ marginTop: 11 }}>
        <button className="disclosure" onClick={() => setOpen(!open)} aria-expanded={open}>
          {open ? 'Close' : won ? 'Delivery, rights and sightings' : 'Details'}
        </button>
      </div>
      {open && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--line-soft)', paddingTop: 12 }}>
          {won && <WonDetail deal={deal} today={today} />}
          <label className="field">
            <span className="lbl">Notes</span>
            <textarea value={deal.notes} onChange={(e) => updateDeal(deal.id, { notes: e.target.value })} />
          </label>
          <Button variant="ghost" onClick={() => removeDeal(deal.id)}>
            Delete deal record
          </Button>
        </div>
      )}
    </div>
  );
}
