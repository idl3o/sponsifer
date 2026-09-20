import { describe, expect, it } from 'vitest';
import {
  loggerSentence,
  onAirSentence,
  parseLoggerStatus,
  placementSentence,
  reportSentence,
  spanOf,
  type LoggerStatus,
  type OnAirSummary,
} from './onair';

const base: OnAirSummary = {
  deal: 'dl-104',
  sources: ['Sponsor overlay'],
  streamStartedAt: '2026-09-18T20:00:00.000+00:00',
  startObserved: true,
  intervals: [
    { source: 'Sponsor overlay', start: '2026-09-18T20:05:00.000+00:00', end: '2026-09-18T20:35:00.000+00:00', seconds: 1800, streamOffsetSeconds: 300 },
    { source: 'Sponsor overlay', start: '2026-09-18T21:00:00.000+00:00', end: '2026-09-18T21:32:00.000+00:00', seconds: 1920, streamOffsetSeconds: 3600 },
  ],
  placements: [{ source: 'Sponsor overlay', totalSeconds: 3720, intervals: 2, openSince: null }],
  totalSeconds: 3720,
  disagreements: 0,
  openSince: null,
  reports: [],
};

describe('spanOf', () => {
  it('reads as a person would say it', () => {
    expect(spanOf(3720)).toBe('1h 02m');
    expect(spanOf(720)).toBe('12m');
    expect(spanOf(45)).toBe('45s');
  });
});

describe('onAirSentence', () => {
  it('sums the intervals', () => {
    expect(onAirSentence(base)).toBe('On air 1h 02m across 2 intervals.');
  });

  it('says what the log could not settle rather than hiding it', () => {
    const s = onAirSentence({ ...base, disagreements: 2, openSince: '2026-09-18T22:00:00.000+00:00' });
    expect(s).toContain('with one still open');
    expect(s).toContain('2 direct checks contradicted an OBS event');
  });

  it('says when offsets into the recording are unknown', () => {
    expect(onAirSentence({ ...base, startObserved: false })).toContain('offsets into the recording unknown');
  });

  it('distinguishes never on air from still on air', () => {
    expect(onAirSentence({ ...base, intervals: [], totalSeconds: 0 })).toBe('Logged, but never on air.');
    expect(onAirSentence({ ...base, intervals: [], totalSeconds: 0, openSince: 'x' })).toMatch(/On air now/);
  });
});

describe('placementSentence', () => {
  it('says nothing when the deal had one placement', () => {
    expect(placementSentence(base)).toBe('');
  });

  it('gives each placement its own time when there were several', () => {
    const placements = [
      { source: 'Sponsor overlay', totalSeconds: 3600, intervals: 1, openSince: null },
      { source: 'Sponsor slate', totalSeconds: 45, intervals: 2, openSince: null },
      { source: 'Sponsor card', totalSeconds: 0, intervals: 0, openSince: null },
    ];
    expect(placementSentence({ ...base, placements })).toBe('Sponsor overlay 1h 00m, Sponsor slate 45s.');
  });
});

describe('reportSentence', () => {
  it('names the latest signed report, or the command to make one', () => {
    expect(reportSentence(base, 'dl-104')).toBe('No signed report yet. Run `sponsifer report dl-104`.');
    expect(reportSentence({ ...base, reports: ['dl-104-20260918T220000Z', 'dl-104-20260919T090000Z'] }, 'dl-104')).toBe(
      'Signed report: dl-104-20260919T090000Z',
    );
  });
});

const idle: LoggerStatus = { running: false, deal: null, since: null, sources: [], missing: [], error: null, needsPassword: false };

describe('parseLoggerStatus', () => {
  it('accepts what the server sends', () => {
    expect(parseLoggerStatus({ ...idle, running: true, deal: 'dl-104', sources: ['Sponsor overlay'] })?.deal).toBe('dl-104');
  });

  it('refuses anything else rather than guessing', () => {
    for (const bad of [null, 'running', [], {}, { ...idle, running: 'yes' }, { ...idle, sources: [1] }, { ...idle, deal: 7 }]) {
      expect(parseLoggerStatus(bad)).toBeNull();
    }
  });
});

describe('loggerSentence', () => {
  const running: LoggerStatus = {
    ...idle, running: true, deal: 'dl-104', since: '2026-09-20T14:02:11.000+00:00', sources: ['Sponsor overlay', 'Sponsor slate'],
  };

  it('says since when, and what is being watched', () => {
    expect(loggerSentence(running, 'dl-104')).toBe('Logging since 14:02 UTC; watching Sponsor overlay, Sponsor slate.');
  });

  it('names a placement OBS does not have, because the log will never see it', () => {
    expect(loggerSentence({ ...running, missing: ['Sponsor card'] }, 'dl-104')).toContain('not in OBS, so not watched: Sponsor card');
  });

  it('points at the deal that holds the logger', () => {
    expect(loggerSentence(running, 'dl-200')).toBe('The logger is running for dl-104. Stop it there before logging this one.');
  });

  it("gives the logger's own reason for stopping, on the deal it was for", () => {
    const stopped = { ...idle, deal: 'dl-104', error: 'OBS closed the connection, so the logger stopped.' };
    expect(loggerSentence(stopped, 'dl-104')).toBe('OBS closed the connection, so the logger stopped.');
    expect(loggerSentence(stopped, 'dl-200')).toMatch(/^Not logging\./);
  });
});
