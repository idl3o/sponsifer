import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { syncStatus } from './store/sync';
import { adoptRenamedSave, useStore } from './store/useStore';

/**
 * Smoke tests: every tab mounts, and the numbers a creator acts on actually
 * appear. These do not assert on layout, only that nothing throws and the
 * derived values reach the screen.
 */

const TABS = ['Profile', 'Rate card', 'An offer', 'Media kit', 'Prospects', 'Outreach', 'Deals', 'Ads', 'Shop board'];

beforeEach(() => {
  useStore.getState().resetToSample();
  useStore.getState().setTab('rate-card');
  // jsdom implements neither of these.
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  window.print = vi.fn();
  // jsdom has no 2D canvas; the board falls back to estimated text widths and skips drawing.
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

describe('App', () => {
  it('mounts every tab without throwing', () => {
    render(<App />);
    for (const label of TABS) {
      fireEvent.click(screen.getByRole('tab', { name: label }));
      expect(screen.getByRole('tab', { name: label })).toHaveProperty('ariaSelected', 'true');
    }
  });

  it('shows a priced placement on the rate card', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'Rate card' }));
    expect(screen.getByText('Top placement')).toBeTruthy();
    expect(screen.getAllByText(/^£[\d,]+$/).length).toBeGreaterThan(0);
  });

  it('reprices every line when usage rights change', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'Rate card' }));
    const before = screen.getByText('Top placement').parentElement?.textContent ?? '';

    const select = screen.getByLabelText(/Usage rights/i);
    fireEvent.change(select, { target: { value: 'full-buyout' } });

    const after = screen.getByText('Top placement').parentElement?.textContent ?? '';
    expect(after).not.toEqual(before);
  });

  it('ranks prospects and puts the weakest last', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'Prospects' }));
    const names = screen.getAllByText(/Linear|Hetzner|Glossier/).map((n) => n.textContent);
    expect(names[names.length - 1]).toBe('Glossier');
  });

  it('composes a pitch naming the brand and a price', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'Outreach' }));
    const email = document.querySelector('.email');
    expect(email?.textContent).toContain('£');
    expect(email?.textContent).toContain('Ada Trelawny');
  });

  it('warns about a profile with no recorded results', () => {
    useStore.getState().updateProfile({ proofPoints: [] });
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'Media kit' }));
    expect(screen.getByText(/No past results recorded/i)).toBeTruthy();
  });

  it('adds and removes a channel from the profile', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'Profile' }));
    const before = useStore.getState().profile.channels.length;

    fireEvent.click(screen.getByRole('button', { name: 'TikTok' }));
    expect(useStore.getState().profile.channels).toHaveLength(before + 1);

    const removes = screen.getAllByRole('button', { name: 'Remove' });
    const last = removes[removes.length - 1];
    if (last) fireEvent.click(last);
    expect(useStore.getState().profile.channels).toHaveLength(before);
  });

  it('records a won deal and closes its prospect', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'Deals' }));
    fireEvent.change(screen.getByLabelText(/Agreed, GBP/i), { target: { value: '2400' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));

    const [deal] = useStore.getState().deals;
    expect(deal?.agreed).toBe(2400);
    const prospect = useStore.getState().prospects.find((p) => p.id === deal?.prospectId);
    expect(prospect?.stage).toBe('won');
    expect(screen.getByText(/agreed a median of/i)).toBeTruthy();
  });

  it('edits the shop board and checks it live', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'Shop board' }));
    expect(screen.getByText('No link yet')).toBeTruthy();

    fireEvent.change(screen.getByLabelText(/Link to the listing/i), { target: { value: 'kernow.build/m/' } });
    expect(useStore.getState().board.linkBase).toBe('kernow.build/m/');
    expect(screen.getByText('Your own domain')).toBeTruthy();

    expect(screen.getByText('Clear of vertical app UI')).toBeTruthy();
    fireEvent.change(screen.getByLabelText(/Position on 9:16/i), { target: { value: 'bottom' } });
    expect(screen.getByText("Under the app's UI in 9:16")).toBeTruthy();
  });

  it('switches the mark to an uploaded image and says it cannot judge it', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'Shop board' }));
    fireEvent.click(screen.getByRole('button', { name: 'Your image' }));
    expect(useStore.getState().board.mark).toBe('logo');
    expect(screen.getByRole('button', { name: 'Upload image' })).toBeTruthy();
    expect(screen.getByText('No image uploaded')).toBeTruthy();
  });

  it('refuses an invalid import, says why, and keeps the workspace', async () => {
    render(<App />);
    const before = useStore.getState().profile;
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([JSON.stringify({ profile: { niche: 'astrology' }, prospects: [] })], 'bad.json');
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText(/Not imported: profile.niche/)).toBeTruthy();
    expect(useStore.getState().profile).toBe(before);
  });

  it('upgrades a first-release save without losing it', async () => {
    const { profile, terms, prospects } = useStore.getState();
    const old = { ...profile, name: 'Saved Before Deals Existed' };
    localStorage.setItem(
      'sponsifer-v1',
      JSON.stringify({ state: { profile: old, terms, prospects, seq: 140 }, version: 0 }),
    );
    await useStore.persist.rehydrate();

    expect(useStore.getState().profile.name).toBe('Saved Before Deals Existed');
    expect(useStore.getState().deals).toEqual([]);
    expect(useStore.getState().seq).toBe(140);
  });

  it('sets an unreadable save aside instead of discarding it', async () => {
    const corrupt = { state: { profile: { niche: 'astrology' }, prospects: [] }, version: 0 };
    localStorage.setItem('sponsifer-v1', JSON.stringify(corrupt));
    await useStore.persist.rehydrate();

    expect(localStorage.getItem('sponsifer-unreadable-v0')).toContain('astrology');
    expect(useStore.getState().profile.niche).not.toBe('astrology');
  });

  it('adopts a save written before the rename, so browser-only work is not stranded', async () => {
    const { profile, terms, prospects } = useStore.getState();
    const older = { ...profile, name: 'Saved Before The Rename' };
    localStorage.removeItem('sponsifer-v1');
    localStorage.setItem(
      'sponsorable-v1',
      JSON.stringify({ state: { profile: older, terms, prospects, seq: 150 }, version: 4 }),
    );
    adoptRenamedSave();
    await useStore.persist.rehydrate();

    expect(useStore.getState().profile.name).toBe('Saved Before The Rename');
    // The old save is left where it is, rather than moved.
    expect(localStorage.getItem('sponsorable-v1')).toContain('Saved Before The Rename');
  });

  it('adopts the newest of two earlier names, because the product was renamed twice', async () => {
    const { profile, terms, prospects } = useStore.getState();
    const save = (name: string, seq: number): string =>
      JSON.stringify({ state: { profile: { ...profile, name }, terms, prospects, seq }, version: 4 });
    localStorage.removeItem('sponsifer-v1');
    localStorage.setItem('sponsorable-v1', save('Saved Under The First Name', 150));
    localStorage.setItem('sponsifable-v1', save('Saved Under The Second Name', 160));
    adoptRenamedSave();
    await useStore.persist.rehydrate();

    expect(useStore.getState().profile.name).toBe('Saved Under The Second Name');
    expect(localStorage.getItem('sponsifable-v1')).toContain('Saved Under The Second Name');
    expect(localStorage.getItem('sponsorable-v1')).toContain('Saved Under The First Name');
  });

  it('shows what the on-air log says for a won deal when the server is serving', async () => {
    const summary = {
      deal: '', sources: ['Sponsor overlay', 'Sponsor slate'], streamStartedAt: null, startObserved: true,
      intervals: [{ source: 'Sponsor overlay', start: 'a', end: 'b', seconds: 1800, streamOffsetSeconds: 300 }],
      placements: [
        { source: 'Sponsor overlay', totalSeconds: 1800, intervals: 1, openSince: null },
        { source: 'Sponsor slate', totalSeconds: 40, intervals: 1, openSince: null },
      ],
      totalSeconds: 1800, disagreements: 1, openSince: null, reports: ['dl-x-20260918T220000Z'],
    };
    vi.stubGlobal('fetch', vi.fn(async (url: string) =>
      String(url).startsWith('/api/onair/')
        ? new Response(JSON.stringify(summary), { status: 200, headers: { 'Content-Type': 'application/json' } })
        : Promise.reject(new Error('offline')),
    ));
    syncStatus.setState({ mode: 'file' });
    try {
      render(<App />);
      fireEvent.click(screen.getByRole('tab', { name: 'Deals' }));
      fireEvent.change(screen.getByLabelText(/Agreed, GBP/i), { target: { value: '2400' } });
      fireEvent.click(screen.getByRole('button', { name: 'Record' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delivery, rights and sightings' }));
      expect(await screen.findByText(/On air 30m across 1 interval; 1 direct check contradicted an OBS event\./)).toBeTruthy();
      expect(screen.getByText(/Signed report: dl-x-20260918T220000Z/)).toBeTruthy();
      expect(screen.getByText(/Sponsor overlay 30m, Sponsor slate 40s\./)).toBeTruthy();
    } finally {
      syncStatus.setState({ mode: 'browser-only' });
    }
  });

  it('starts and stops the on-air logger from a won deal, asking for the OBS password only when OBS does', async () => {
    const idle = { running: false, deal: null, since: null, sources: [], missing: [], error: null, needsPassword: false };
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    const posted: { url: string; body: Record<string, string> }[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url) === '/api/logger') return json(200, idle);
      if (String(url).startsWith('/api/logger/')) {
        const body = JSON.parse(String(init?.body)) as Record<string, string>;
        posted.push({ url: String(url), body });
        const deal = body.deal ?? null;
        if (String(url).endsWith('/stop')) return json(200, { ...idle, deal: posted[0]?.body.deal ?? null });
        return body.password === 'hunter2'
          ? json(200, { ...idle, running: true, deal, since: '2026-09-20T14:02:00.000+00:00', sources: ['Sponsor overlay'], missing: ['Sponsor card'] })
          : json(502, { ...idle, deal, error: 'OBS asks for its WebSocket password.', needsPassword: true });
      }
      return Promise.reject(new Error('offline'));
    }));
    syncStatus.setState({ mode: 'file' });
    try {
      render(<App />);
      fireEvent.click(screen.getByRole('tab', { name: 'Deals' }));
      fireEvent.change(screen.getByLabelText(/Agreed, GBP/i), { target: { value: '2400' } });
      fireEvent.click(screen.getByRole('button', { name: 'Record' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delivery, rights and sightings' }));

      fireEvent.click(await screen.findByRole('button', { name: 'Start logging' }));
      const field = await screen.findByLabelText(/OBS WebSocket password/);
      expect(screen.getByText('OBS asks for its WebSocket password.')).toBeTruthy();

      fireEvent.change(field, { target: { value: 'hunter2' } });
      fireEvent.click(screen.getByRole('button', { name: 'Start logging' }));
      expect(await screen.findByText(/Logging since 14:02 UTC; watching Sponsor overlay; not in OBS, so not watched: Sponsor card\./)).toBeTruthy();
      expect(screen.queryByLabelText(/OBS WebSocket password/)).toBeNull();
      expect(JSON.stringify(localStorage)).not.toContain('hunter2');
      expect(JSON.stringify(useStore.getState())).not.toContain('hunter2');

      fireEvent.click(screen.getByRole('button', { name: 'Stop logging' }));
      expect(await screen.findByText(/^Not logging\./)).toBeTruthy();
      expect(posted.map((p) => p.url)).toEqual(['/api/logger/start', '/api/logger/start', '/api/logger/stop']);
      expect(posted.filter((p) => 'password' in p.body)).toHaveLength(1);
    } finally {
      syncStatus.setState({ mode: 'browser-only' });
    }
  });

  it('keeps the logger control when the server refuses, so a deal still being saved can be tried again', async () => {
    const idle = { running: false, deal: null, since: null, sources: [], missing: [], error: null, needsPassword: false };
    const json = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
    let starts = 0;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (String(url) === '/api/logger') return json(200, idle);
      if (String(url) === '/api/logger/start') {
        starts += 1;
        return starts === 1
          ? json(404, { error: 'no deal dl-101 in the workspace file yet; try again in a moment' })
          : json(200, { ...idle, running: true, deal: useStore.getState().deals[0]?.id ?? null, sources: ['Sponsor overlay'] });
      }
      return Promise.reject(new Error('offline'));
    }));
    syncStatus.setState({ mode: 'file' });
    try {
      render(<App />);
      fireEvent.click(screen.getByRole('tab', { name: 'Deals' }));
      fireEvent.change(screen.getByLabelText(/Agreed, GBP/i), { target: { value: '2400' } });
      fireEvent.click(screen.getByRole('button', { name: 'Record' }));
      fireEvent.click(screen.getByRole('button', { name: 'Delivery, rights and sightings' }));

      fireEvent.click(await screen.findByRole('button', { name: 'Start logging' }));
      expect(await screen.findByText(/^Not started: no deal dl-101 in the workspace file yet; try again in a moment\.$/)).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Start logging' }));
      expect(await screen.findByRole('button', { name: 'Stop logging' })).toBeTruthy();
      expect(screen.queryByText(/^Not started:/)).toBeNull();
    } finally {
      syncStatus.setState({ mode: 'browser-only' });
    }
  });

  it('makes an ad directly for a sponsor who never was a prospect, and finds it again by name', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'Ads' }));
    expect(screen.getByText(/No ads yet/)).toBeTruthy();

    for (const sponsor of ['Tailscale', 'Hetzner']) {
      fireEvent.change(screen.getByLabelText('Sponsor'), { target: { value: sponsor } });
      fireEvent.click(screen.getByRole('button', { name: 'Make the ad' }));
    }
    const deals = useStore.getState().deals;
    expect(deals.map((d) => d.brand).sort()).toEqual(['Hetzner', 'Tailscale']);
    expect(deals.every((d) => d.outcome === 'won' && d.prospectId === '' && d.quoted > 0)).toBe(true);
    expect(screen.getByText('2 ads.')).toBeTruthy();
    // The ad just made is opened, ready to be put on stream.
    expect(screen.getByRole('button', { name: 'Copy OBS URL' })).toBeTruthy();

    fireEvent.change(screen.getByLabelText('Find an ad'), { target: { value: 'tail' } });
    expect(screen.getByText('1 of 2 ads.')).toBeTruthy();
    expect(screen.getByText('Tailscale')).toBeTruthy();
    expect(screen.queryByText('Hetzner')).toBeNull();

    // No fee was recorded, so the ground truth says nothing rather than reading two closes at 0%.
    fireEvent.click(screen.getByRole('tab', { name: 'Deals' }));
    expect(screen.getByText(/No won deals recorded yet/)).toBeTruthy();
    expect(screen.getAllByText(/fee not recorded/)).toHaveLength(2);
  });

  it('edits the emblem by hand on a won deal, and the house style follows', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'Deals' }));
    fireEvent.change(screen.getByLabelText(/Agreed, GBP/i), { target: { value: '2400' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delivery, rights and sightings' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit emblem' }));

    expect(screen.getByLabelText('Stream preview').querySelector('.ad-badge')?.textContent).toMatch(/^Ad/);
    fireEvent.click(screen.getByRole('button', { name: 'Bottom right' }));
    expect(useStore.getState().emblem.corner).toBe('bottom-right');
    fireEvent.click(screen.getByRole('button', { name: 'Powered by' }));
    const [deal] = useStore.getState().deals;
    expect(deal?.sponsorArt?.wording).toBe('powered-by');
    expect(screen.getByLabelText('Stream preview').textContent).toContain('Powered by');
  });

  it('offers each further placement with the OBS source name the log looks for', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'Deals' }));
    fireEvent.change(screen.getByLabelText(/Agreed, GBP/i), { target: { value: '2400' } });
    fireEvent.click(screen.getByRole('button', { name: 'Record' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delivery, rights and sightings' }));
    for (const name of ['Sponsor lower third', 'Sponsor slate', 'Sponsor card']) {
      expect(screen.getByText(new RegExp(`Name the source "${name}"`))).toBeTruthy();
    }
    fireEvent.click(screen.getByRole('button', { name: 'Edit emblem' }));
    fireEvent.click(screen.getByRole('button', { name: 'Segment slate' }));
    expect(screen.getByLabelText('Stream preview').querySelector('.ad-kind-slate')?.textContent).toMatch(/^Ad/);
  });

  it('judges an offer against the card and says what to reply', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'An offer' }));
    fireEvent.change(screen.getByLabelText(/What they have offered/i), { target: { value: '100' } });
    expect(screen.getAllByText(/below your walk-away/i).length).toBeGreaterThan(0);
    const email = document.querySelector('.email')?.textContent ?? '';
    expect(email).toContain('£100');
    expect(email).toMatch(/under what this placement sells for/);
  });

  it('takes a good offer without arguing about it', () => {
    render(<App />);
    fireEvent.click(screen.getByRole('tab', { name: 'An offer' }));
    fireEvent.change(screen.getByLabelText(/What they have offered/i), { target: { value: '9000' } });
    expect(screen.getAllByText(/above your ask/i).length).toBeGreaterThan(0);
    expect(document.querySelector('.email')?.textContent).toMatch(/that works/i);
  });

  it('says the workspace is kept in this browser when no server is syncing it', () => {
    render(<App />);
    expect(screen.getByText('Saved in this browser only')).toBeTruthy();
  });

  it('counts on from the highest id in an imported workspace, so new ids never repeat one', () => {
    const { profile, terms, prospects, board, emblem } = useStore.getState();
    const channels = [...profile.channels.slice(0, 1).map((c) => ({ ...c, id: 'ch-500' }))];
    useStore.getState().importAll({ version: 5, profile: { ...profile, channels }, terms, prospects, deals: [], board, emblem });
    useStore.getState().addChannel('x');
    expect(useStore.getState().profile.channels.map((c) => c.id)).toContain('ch-501');
  });

  it('generates ids without randomness, so two adds are predictable', () => {
    const { addChannel } = useStore.getState();
    const seqBefore = useStore.getState().seq;
    addChannel('tiktok');
    addChannel('x');
    const ids = useStore.getState().profile.channels.slice(-2).map((c) => c.id);
    expect(ids).toEqual([`ch-${seqBefore + 1}`, `ch-${seqBefore + 2}`]);
  });
});
