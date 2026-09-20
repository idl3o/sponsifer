import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BOARD } from '../domain/board';
import { DEFAULT_EMBLEM } from '../domain/emblem';
import { DEFAULT_TERMS } from '../domain/pricing';
import { workspaceOf } from '../domain/workspace';
import { SAMPLE_PROFILE, SAMPLE_PROSPECTS } from '../store/sample';
import type { Fetch } from '../store/workspaceClient';
import { Dock } from './Dock';

/**
 * The dock sits in OBS's own window, which gets captured and shared. These
 * test what a streamer reads there, and that the deal's money never reaches it.
 */

const deal = (id: string, brand: string, closedOn: string) => ({
  id, prospectId: '', brand, outcome: 'won', lostReason: null, closedOn,
  platform: 'twitch', format: 'stream', niche: 'technology', geo: { tier1: 1, tier2: 0, tier3: 0 },
  followers: 4000, medianViews: 90, engagementRate: 0.05, terms: DEFAULT_TERMS, paidUsageDays: 0, quoted: 4517,
  flooredByProduction: true, fitAtClose: 70, agreed: 3906, deliveredOn: '', paidOn: '', seal: null, sightings: [],
  sponsorArt: null, notes: 'fee is confidential',
});
const fileWith = (deals: unknown[]) =>
  JSON.stringify(workspaceOf({ profile: SAMPLE_PROFILE, terms: DEFAULT_TERMS, prospects: SAMPLE_PROSPECTS, deals: deals as never, board: DEFAULT_BOARD, emblem: DEFAULT_EMBLEM }));

const idle = {
  running: false, deal: null, since: null, sources: [], missing: [], error: null, needsPassword: false,
  streamLive: false, placements: [],
};
const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });

/** A server: the workspace file, the logger's status (which a test may change), and no on-air log. */
function server(file: string, logger: { status: unknown }): { fetcher: Fetch; posted: string[] } {
  const posted: string[] = [];
  const fetcher = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url);
    if (path === '/api/workspace') return json(200, file, { ETag: '"r1"' });
    if (path === '/api/logger') return json(200, logger.status);
    if (path.startsWith('/api/logger/')) {
      posted.push(`${path} ${String(init?.body)}`);
      logger.status = path.endsWith('/start') ? { ...idle, running: true, deal: 'dl-104', sources: ['Sponsor overlay'] } : idle;
      return json(200, logger.status);
    }
    return json(404, { missing: true });
  }) as unknown as Fetch;
  return { fetcher, posted };
}

async function tick(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Dock', () => {
  it('says what it is waiting for when the server is not there, because a dock is not on stream', async () => {
    const fetcher = vi.fn(() => Promise.reject(new Error('offline'))) as unknown as Fetch;
    render(<Dock asked={null} fetcher={fetcher} />);
    await tick(0);
    expect(screen.getByText(/Waiting for Sponsifer/)).toBeTruthy();
  });

  it('says so when there is no won deal to stream for', async () => {
    render(<Dock asked={null} fetcher={server(fileWith([]), { status: idle }).fetcher} />);
    await tick(0);
    expect(screen.getByText(/No won deal waiting to be delivered/)).toBeTruthy();
  });

  it('opens on the most recent deal, knows nothing until the logger runs, and starts it', async () => {
    const logger = { status: idle as unknown };
    const { fetcher, posted } = server(fileWith([deal('dl-101', 'Linear', '2026-08-01'), deal('dl-104', 'Hetzner', '2026-09-10')]), logger);
    render(<Dock asked={null} fetcher={fetcher} />);
    await tick(0);

    expect((screen.getByLabelText('Sponsor') as HTMLSelectElement).value).toBe('dl-104');
    expect(screen.getByText('Not logging.')).toBeTruthy();
    expect(screen.getAllByText('Not watched')).toHaveLength(4);

    fireEvent.click(screen.getByRole('button', { name: 'Start logging' }));
    await tick(0);
    expect(posted).toEqual(['/api/logger/start {"deal":"dl-104"}']);
    expect(screen.getByRole('button', { name: 'Stop logging' })).toBeTruthy();
    expect((screen.getByLabelText('Sponsor') as HTMLSelectElement).disabled).toBe(true);
  });

  it('follows the logger without being touched: in program, then on air, then down', async () => {
    const running = { ...idle, running: true, deal: 'dl-104', sources: ['Sponsor overlay'], missing: ['Sponsor card'] };
    const logger = { status: { ...running, placements: [{ source: 'Sponsor overlay', inProgram: true, onAirSince: null }] } as unknown };
    render(<Dock asked={null} fetcher={server(fileWith([deal('dl-104', 'Hetzner', '2026-09-10')]), logger).fetcher} pollMs={3000} />);
    await tick(0);
    expect(screen.getByText('Logging. The stream is not live, so nothing counts yet.')).toBeTruthy();
    expect(screen.getByText('In program, not live')).toBeTruthy();
    expect(screen.getByText('Not in OBS')).toBeTruthy();

    logger.status = { ...running, streamLive: true, placements: [{ source: 'Sponsor overlay', inProgram: true, onAirSince: '2026-09-20T14:05:00.000+00:00' }] };
    await tick(3000);
    expect(screen.getByText('On air: Corner emblem.')).toBeTruthy();
    expect(screen.getByText('On air since 14:05 UTC')).toBeTruthy();

    logger.status = { ...running, streamLive: true, placements: [{ source: 'Sponsor overlay', inProgram: false, onAirSince: null }] };
    await tick(3000);
    expect(screen.getByText('Live and logging. No placement is on air.')).toBeTruthy();
  });

  it('never shows the deal’s money, whatever state it is in', async () => {
    const logger = { status: { ...idle, running: true, deal: 'dl-104', sources: ['Sponsor overlay'] } as unknown };
    const { container } = render(<Dock asked={null} fetcher={server(fileWith([deal('dl-104', 'Hetzner', '2026-09-10')]), logger).fetcher} />);
    await tick(0);
    expect(container.textContent).toContain('Hetzner');
    expect(container.textContent).not.toMatch(/4517|4,517|3906|3,906|£|confidential/);
  });
});
