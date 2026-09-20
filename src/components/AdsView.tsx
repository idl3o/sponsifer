import { useMemo, useState } from 'react';
import { AD_FILTERS, AD_SORTS, adsOf, findAds, type Ad, type AdFilter, type AdSort } from '../domain/ads';
import { FORMAT_LABEL, PLATFORM_LABEL } from '../domain/benchmarks';
import { directDeal } from '../domain/deals';
import { buildRateCard } from '../domain/pricing';
import type { RateLine } from '../domain/types';
import { useStore } from '../store/useStore';
import { OnStream } from './OnStream';
import { Button, Card, NumberField, Pill, SelectField, TextField, money } from './ui/Primitives';

const lineKey = (line: RateLine): string => `${line.channelId}:${line.format}`;
const lineLabel = (line: RateLine): string =>
  `${FORMAT_LABEL[line.format]} on ${PLATFORM_LABEL[line.platform]}, quoted ${money(line.target)}`;

function FeeField({ agreed, onChange }: { agreed: number; onChange: (value: number) => void }) {
  return (
    <NumberField
      label="Agreed, GBP"
      value={agreed}
      onChange={onChange}
      step={10}
      hint="Leave at 0 if you would rather not record it. A deal with no fee is left out of your calibration."
    />
  );
}

/**
 * Make an ad for a sponsor who never was a prospect. It records a won deal, so
 * the overlay, the log and the report work as they do for any other; the fee is
 * optional, and a deal without one is left out of the calibration.
 */
function NewAdCard({ today, onMade }: { today: string; onMade: (dealId: string) => void }) {
  const profile = useStore((s) => s.profile);
  const terms = useStore((s) => s.terms);
  const recordDeal = useStore((s) => s.recordDeal);
  const lines = useMemo(() => buildRateCard(profile, terms).filter((l) => l.target > 0), [profile, terms]);
  const [brand, setBrand] = useState('');
  const [chosenLine, setChosenLine] = useState('');
  const [agreed, setAgreed] = useState(0);
  const line = lines.find((l) => lineKey(l) === chosenLine) ?? lines[0];

  if (!line) {
    return (
      <Card title="Make an ad" tight>
        <p className="note">Add a channel with a priced format to your profile first. The ad is frozen from it.</p>
      </Card>
    );
  }
  const make = () => {
    // The id is only known inside the store's update, so it is carried out and announced after it.
    const made: { id: string | null } = { id: null };
    recordDeal((id) => {
      const deal = directDeal(profile, line, terms, { id, brand, agreed, closedOn: today });
      made.id = deal?.id ?? null;
      return deal;
    });
    if (made.id) onMade(made.id);
    setBrand('');
    setAgreed(0);
  };
  return (
    <Card
      title="Make an ad"
      subtitle="For a sponsor you already have. It records a won deal, so the overlay, the on-air log and the signed report all work as they do for any other."
      tight
    >
      <TextField label="Sponsor" value={brand} onChange={setBrand} placeholder="The name as it should read on stream" />
      <SelectField
        label="What you sold"
        value={lineKey(line)}
        options={lines.map((l) => ({ value: lineKey(l), label: lineLabel(l) }))}
        onChange={setChosenLine}
      />
      <FeeField agreed={agreed} onChange={setAgreed} />
      <Button variant="primary" disabled={brand.trim() === ''} onClick={make}>
        Make the ad
      </Button>
    </Card>
  );
}

/** One ad in the library, opening into everything that puts it on stream. */
function AdRow({ ad, open, onToggle }: { ad: Ad; open: boolean; onToggle: () => void }) {
  const deal = useStore((s) => s.deals.find((d) => d.id === ad.dealId));
  return (
    <div className="prospect">
      <div className="spread">
        <div style={{ minWidth: 0 }}>
          <div className="row" style={{ gap: 8 }}>
            <strong>{ad.brand || 'Unnamed sponsor'}</strong>
            <Pill tone={ad.delivered ? 'plain' : 'good'}>{ad.delivered ? 'delivered' : 'to deliver'}</Pill>
            {!ad.hasArt && <Pill tone="warn">no sponsor art yet</Pill>}
            {ad.direct && <Pill>made directly</Pill>}
          </div>
          <div className="note" style={{ marginTop: 3 }}>
            {ad.placement} · {ad.dealId} · closed {ad.closedOn}
          </div>
        </div>
      </div>
      <div className="row" style={{ marginTop: 11 }}>
        <button className="disclosure" onClick={onToggle} aria-expanded={open}>
          {open ? 'Close' : 'Put it on stream'}
        </button>
      </div>
      {open && deal && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--line-soft)', paddingTop: 12 }}>
          <OnStream deal={deal} />
        </div>
      )}
    </div>
  );
}

/** Search, filter and order, over every ad. */
function Library({ ads, opened, onToggle }: { ads: Ad[]; opened: string | null; onToggle: (dealId: string) => void }) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<AdFilter>('all');
  const [sort, setSort] = useState<AdSort>('sponsor');
  const found = useMemo(() => findAds(ads, { query, filter, sort }), [ads, query, filter, sort]);
  return (
    <>
      <div className="grid cols-2">
        <TextField label="Find an ad" value={query} onChange={setQuery} placeholder="Sponsor, what you sold, or a deal id" />
        <div className="grid cols-2">
          <SelectField label="Show" value={filter} options={[...AD_FILTERS]} onChange={setFilter} />
          <SelectField label="Order" value={sort} options={[...AD_SORTS]} onChange={setSort} />
        </div>
      </div>
      <p className="note" role="status">
        {found.length === ads.length ? `${ads.length} ad${ads.length === 1 ? '' : 's'}.` : `${found.length} of ${ads.length} ads.`}
      </p>
      {found.map((ad) => (
        <AdRow key={ad.dealId} ad={ad} open={opened === ad.dealId} onToggle={() => onToggle(ad.dealId)} />
      ))}
    </>
  );
}

/** Every ad, findable by sponsor, and a way to make one without walking the pipeline first. */
export function AdsView({ today }: { today: string }) {
  const deals = useStore((s) => s.deals);
  const ads = useMemo(() => adsOf(deals), [deals]);
  const [opened, setOpened] = useState<string | null>(null);
  return (
    <>
      <h1>Ads</h1>
      <p className="lede">
        Every sponsor you have put, or are about to put, on stream. An ad is a won deal seen from the stream's side, so
        nothing here exists that the on-air log and the signed report do not also know about.
      </p>
      <div className="split">
        <div>
          {ads.length === 0 ? (
            <div className="empty">No ads yet. Make one on the right, or record a won deal under Deals.</div>
          ) : (
            <Library ads={ads} opened={opened} onToggle={(id) => setOpened(opened === id ? null : id)} />
          )}
        </div>
        <div className="stack">
          <NewAdCard today={today} onMade={setOpened} />
        </div>
      </div>
    </>
  );
}
