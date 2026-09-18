import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BOARD } from '../domain/board';
import { DEFAULT_EMBLEM } from '../domain/emblem';
import { DEFAULT_TERMS } from '../domain/pricing';
import { workspaceOf } from '../domain/workspace';
import { SAMPLE_PROFILE, SAMPLE_PROSPECTS } from '../store/sample';
import { Overlay } from './Overlay';

/**
 * The overlay is on stream, so these test what viewers see when things go
 * wrong: nothing, or the last good frame. Never an error.
 */

const deal = {
  id: 'dl-104', prospectId: '', brand: 'Hetzner', outcome: 'won', lostReason: null, closedOn: '2026-09-10',
  platform: 'twitch', format: 'stream', niche: 'technology', geo: { tier1: 1, tier2: 0, tier3: 0 },
  followers: 4000, medianViews: 90, engagementRate: 0.05, terms: DEFAULT_TERMS, paidUsageDays: 0, quoted: 450,
  flooredByProduction: true, fitAtClose: 70, agreed: 400, deliveredOn: '', paidOn: '', seal: null, sightings: [], notes: '',
};
const FILE = JSON.stringify(
  workspaceOf({ profile: SAMPLE_PROFILE, terms: DEFAULT_TERMS, prospects: SAMPLE_PROSPECTS, deals: [deal] as never, board: DEFAULT_BOARD, emblem: DEFAULT_EMBLEM }),
);

const answer = () =>
  new Response(FILE, { status: 200, headers: { 'Content-Type': 'application/json', ETag: '"r1"' } });

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

describe('Overlay', () => {
  it('draws the ad label and the sponsor, and no price', async () => {
    const { container } = render(<Overlay dealId="dl-104" fetcher={vi.fn(async () => answer())} />);
    await tick(0);
    expect(container.textContent).toBe('AdSponsored by Hetzner');
    expect(container.textContent).not.toMatch(/£|400|450/);
  });

  it('draws nothing, and says nothing, when it has never loaded', async () => {
    const fetcher = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const { container } = render(<Overlay dealId="dl-104" fetcher={fetcher} />);
    await tick(20_000);
    expect(container.innerHTML).toBe('');
  });

  it('keeps the last good frame when the server goes away', async () => {
    const fetcher = vi.fn(async () => answer());
    const { container } = render(<Overlay dealId="dl-104" fetcher={fetcher} pollMs={1000} />);
    await tick(0);
    fetcher.mockRejectedValue(new TypeError('Failed to fetch'));
    await tick(5000);
    expect(fetcher.mock.calls.length).toBeGreaterThan(3);
    expect(container.textContent).toBe('AdSponsored by Hetzner');
  });

  it('draws the sponsor art, and the label with it, when the deal has one', async () => {
    const art = { image: 'data:image/png;base64,iVBORw0KGgo=', imageAspect: 2, wording: 'powered-by', accent: '#ff0000' };
    const withArt = JSON.stringify({ ...JSON.parse(FILE), deals: [{ ...deal, sponsorArt: art }] });
    const fetcher = vi.fn(async () =>
      new Response(withArt, { status: 200, headers: { 'Content-Type': 'application/json', ETag: '"r2"' } }));
    const { container } = render(<Overlay dealId="dl-104" fetcher={fetcher} />);
    await tick(0);
    expect(container.querySelector('img.ad-art')?.getAttribute('src')).toBe(art.image);
    expect(container.textContent).toBe('AdPowered by Hetzner');
    expect((container.querySelector('.ad-badge') as HTMLElement).style.getPropertyValue('--ad-accent')).toBe('#ff0000');
  });

  it('draws nothing for a deal that is not a won deal in the file', async () => {
    const { container } = render(<Overlay dealId="dl-999" fetcher={vi.fn(async () => answer())} />);
    await tick(0);
    expect(container.innerHTML).toBe('');
  });
});
