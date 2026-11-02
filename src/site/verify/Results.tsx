import type { ReactNode } from 'react';
import { recordingAt, span, type Receipt, type Report } from '../documents';
import type { Check, Outcome, State } from '../verify';

/**
 * What the checker found, in the order a sponsor needs it: one sentence on
 * whether to rely on the file, each check with its reason, then what the
 * document says. State is never shown by colour alone: each check carries a
 * mark and words.
 */

const MARK: Record<State, string> = { pass: '✓', warn: '!', fail: '✗' };
const SAID: Record<State, string> = { pass: 'Passed', warn: 'Note', fail: 'Failed' };

/** How long each platform keeps a live recording. Mirrors VOD_RETENTION in python/sponsifer/report.py. */
const RETENTION: Readonly<Record<string, string>> = {
  twitch: 'Twitch keeps a past broadcast for 7 days, 14 for Affiliates and 60 for Partners, and highlights do not expire',
  youtube: 'YouTube keeps a live archive until the creator removes it',
};

function headline(outcome: Outcome): { state: State; title: string; text: string } {
  const what = outcome.document.kind === 'receipt' ? 'licence receipt' : 'report';
  if (outcome.trusted) {
    return { state: 'pass', title: `This ${what} is the creator's, unchanged.`, text: 'Signed by the key in your agreement, byte for byte as signed.' };
  }
  if (outcome.checks.some((c) => c.state === 'fail')) {
    return { state: 'fail', title: 'Do not rely on this file.', text: 'At least one check failed; each says why below.' };
  }
  const waiting = outcome.checks.find((c) => c.label === 'The key, against your agreement')?.state === 'warn';
  return waiting
    ? { state: 'warn', title: 'The signature is good. Now check the key.', text: 'Enter the fingerprint from your agreement above.' }
    : { state: 'warn', title: 'Checked, with something to note.', text: 'Read the notes below.' };
}

function Checks({ checks }: { checks: readonly Check[] }) {
  return (
    <ul className="checks">
      {checks.map((c) => (
        <li key={c.label} className={c.state}>
          <span className="mark" aria-hidden="true">{MARK[c.state]}</span>
          <span><span className="visually-hidden">{SAID[c.state]}: </span><strong>{c.label}</strong></span>
          <span className="why">{c.why}</span>
        </li>
      ))}
    </ul>
  );
}

function Fact({ term, children }: { term: string; children: ReactNode }) {
  return <><dt>{term}</dt><dd>{children}</dd></>;
}

function reportNotes(report: Report): string[] {
  const notes: string[] = [];
  if (report.disagreements > 0) {
    notes.push(`${report.disagreements} time${report.disagreements === 1 ? '' : 's'} OBS's direct answer contradicted an event it had sent. Each is in the creator's log, and the direct answer is what counts.`);
  }
  if (report.openSince) notes.push(`The logger stopped while a placement was still on air, at ${report.openSince}. That time is not counted.`);
  if (!report.startObserved && report.intervals.length > 0) notes.push('The logger joined after the stream began, so there are no offsets into the recording; use the UTC times.');
  if (report.canvases !== null && report.canvases > 1) notes.push(`OBS was running ${report.canvases} canvases, so the log cannot say which feed a placement was in.`);
  notes.push(`${RETENTION[report.platform] ?? 'Platforms keep a live recording for a limited time'}. Check the recording soon.`);
  return notes;
}

function Intervals({ report }: { report: Report }) {
  if (report.intervals.length === 0) return <p className="muted">No completed interval on air.</p>;
  return (
    <div className="table-wrap">
      <table className="intervals">
        <thead><tr><th scope="col">Placement</th><th scope="col">On air (UTC)</th><th scope="col">For</th><th scope="col">Into the recording</th></tr></thead>
        <tbody>
          {report.intervals.map((i) => {
            const link = i.offset === null ? null : recordingAt(report.vodUrl, i.offset);
            return (
              <tr key={`${i.source}-${i.start}`}>
                <td>{i.source}</td>
                <td>{i.start} to {i.end}</td>
                <td>{span(i.seconds)}</td>
                <td>{i.offset === null ? 'unknown' : link
                  ? <a href={link} target="_blank" rel="noopener noreferrer">{span(i.offset)}: open the recording here</a>
                  : span(i.offset)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ReportView({ report }: { report: Report }) {
  const delivery = report.kind === 'delivery-report';
  return (
    <section aria-labelledby="what-it-says">
      <h2 id="what-it-says">What the {delivery ? 'delivery report' : 'airtime report'} says</h2>
      <dl className="facts">
        <Fact term="Creator">{report.creator || 'not named'}</Fact>
        {delivery ? <Fact term="Sponsor">{report.sponsor}</Fact> : <Fact term="Label">{report.label} (no sponsor's deal)</Fact>}
        {report.dealId && <Fact term="Deal">{report.dealId}</Fact>}
        <Fact term="Platform">{report.platform || 'not named'}</Fact>
        <Fact term="Placements watched">{report.sources.join(', ')}</Fact>
        <Fact term="On air in total">{span(report.totalSeconds)}, a moment counted once however many placements were up</Fact>
        <Fact term="Recording">{report.vodUrl || 'not given; ask the creator for its address'}</Fact>
        <Fact term="Signed">{report.reportedAt}</Fact>
      </dl>
      <h3>Each interval</h3>
      <Intervals report={report} />
      <h3>Notes</h3>
      <ul>{reportNotes(report).map((n) => <li key={n}>{n}</li>)}</ul>
    </section>
  );
}

function ReceiptView({ receipt }: { receipt: Receipt }) {
  return (
    <section aria-labelledby="what-it-says">
      <h2 id="what-it-says">What the licence receipt says</h2>
      <dl className="facts">
        <Fact term="Serial">{receipt.serial}</Fact>
        <Fact term="Deal">{receipt.dealId}</Fact>
        <Fact term="From">{receipt.creator || 'not named'}</Fact>
        <Fact term="To">{receipt.sponsor}</Fact>
        <Fact term="Usage rights">{receipt.usageRights}</Fact>
        <Fact term="Paid use">{receipt.paidUsageDays === null ? 'unlimited' : `${receipt.paidUsageDays} days`}</Fact>
        <Fact term="Sealed on">{receipt.sealedOn}</Fact>
        <Fact term="Sealed file (SHA-256)"><code>{receipt.sealedSha256}</code></Fact>
      </dl>
      <p className="muted">Add the delivered file to the files above to check it is the one this receipt seals.</p>
    </section>
  );
}

export function Results({ outcome }: { outcome: Outcome }) {
  const head = headline(outcome);
  const doc = outcome.document;
  return (
    <div aria-live="polite">
      <div className={`verdict ${head.state}`} role="status">
        <strong>{head.title}</strong>
        <span className="muted">{head.text}</span>
      </div>
      <Checks checks={outcome.checks} />
      {doc.kind === 'receipt' ? <ReceiptView receipt={doc} /> : doc.kind === 'unknown' ? null : <ReportView report={doc} />}
    </div>
  );
}
