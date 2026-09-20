/**
 * The deal panel as OBS shows it in a dock: which sponsor this stream is for,
 * whether it is being logged, and what is on air this moment.
 *
 * A dock is part of OBS's own window, and OBS's window ends up on stream more
 * often than a streamer means it to: a window capture, a shared screen, a
 * tutorial. So the dock follows the overlay's rule and carries no price. The
 * types here have no field one could travel in, and `dock.test.ts` locks the
 * key sets.
 *
 * What is on air now comes from the running logger's own state, never from
 * folding the log: the log's open interval may be one an earlier run left open.
 */

import { PLACEMENTS, type PlacementKind } from './emblem';
import type { LoggerStatus } from './onair';
import type { Workspace } from './workspace';

/** A deal a stream could be for, as the dock's chooser lists it. */
export interface DockDeal {
  id: string;
  brand: string;
}

/**
 * - `on-air`: the stream is live and the placement is in the program feed.
 * - `in-program`: in the program feed, but the stream is not live. A wiring check before going live.
 * - `watched`: the logger has it, and it is not showing.
 * - `not-in-obs`: OBS has no source of this name, so the log will never see it.
 * - `unknown`: no logger is running for this deal, so nothing is known.
 */
export type PlacementState = 'on-air' | 'in-program' | 'watched' | 'not-in-obs' | 'unknown';

export interface DockPlacement {
  kind: PlacementKind;
  label: string;
  /** The OBS source name the logger looks for. */
  sourceName: string;
  state: PlacementState;
  /** When it went on air, while it is on air. */
  since: string | null;
}

export interface DockView {
  dealId: string;
  brand: string;
  /** One sentence on what is happening now. */
  headline: string;
  tone: 'on-air' | 'logging' | 'idle';
  placements: DockPlacement[];
}

/** Won deals not yet delivered, the most recently closed first: the ones a stream could be for. */
export function dockDeals(workspace: Workspace): DockDeal[] {
  return workspace.deals
    .filter((deal) => deal.outcome === 'won' && deal.deliveredOn === '')
    .slice()
    .sort((a, b) => b.closedOn.localeCompare(a.closedOn) || b.id.localeCompare(a.id))
    .map((deal) => ({ id: deal.id, brand: deal.brand }));
}

/**
 * Which deal the dock opens on. The deal being logged wins, because it is the
 * one on stream now; then the one the address or the streamer asked for; then
 * the most recent.
 */
export function pickDockDeal(deals: readonly DockDeal[], asked: string | null, logging: string | null): string | null {
  const has = (id: string | null): id is string => id !== null && deals.some((deal) => deal.id === id);
  if (has(logging)) return logging;
  if (has(asked)) return asked;
  return deals[0]?.id ?? null;
}

function stateOf(sourceName: string, logger: LoggerStatus): { state: PlacementState; since: string | null } {
  if (logger.missing.includes(sourceName)) return { state: 'not-in-obs', since: null };
  const now = logger.placements.find((p) => p.source === sourceName);
  if (!now) return { state: logger.sources.includes(sourceName) ? 'watched' : 'unknown', since: null };
  if (now.onAirSince !== null) return { state: 'on-air', since: now.onAirSince };
  return { state: now.inProgram ? 'in-program' : 'watched', since: null };
}

function headlineOf(placements: readonly DockPlacement[], logger: LoggerStatus): Pick<DockView, 'headline' | 'tone'> {
  const up = placements.filter((p) => p.state === 'on-air');
  if (up.length > 0) return { headline: `On air: ${up.map((p) => p.label).join(', ')}.`, tone: 'on-air' };
  if (logger.streamLive) return { headline: 'Live and logging. No placement is on air.', tone: 'logging' };
  return { headline: 'Logging. The stream is not live, so nothing counts yet.', tone: 'logging' };
}

/** The dock's view of one deal. `logger` is null while the server has not answered, or has no logger. */
export function dockView(deal: DockDeal, logger: LoggerStatus | null): DockView {
  const mine = logger !== null && logger.running && logger.deal === deal.id;
  const placements = PLACEMENTS.map((p): DockPlacement => ({
    kind: p.value,
    label: p.label,
    sourceName: p.sourceName,
    ...(mine ? stateOf(p.sourceName, logger) : { state: 'unknown' as const, since: null }),
  }));
  if (mine) return { dealId: deal.id, brand: deal.brand, placements, ...headlineOf(placements, logger) };
  const elsewhere = logger !== null && logger.running;
  const headline = elsewhere ? `Logging ${logger.deal ?? 'another deal'}, not this one.` : 'Not logging.';
  return { dealId: deal.id, brand: deal.brand, placements, headline, tone: 'idle' };
}

/** What each state is called in the dock. */
export const PLACEMENT_STATE_LABEL: Record<PlacementState, string> = {
  'on-air': 'On air',
  'in-program': 'In program, not live',
  watched: 'Watched',
  'not-in-obs': 'Not in OBS',
  unknown: 'Not watched',
};

/** The address to add under Docks, Custom Browser Docks, in OBS. One dock serves every deal. */
export function dockUrl(origin: string): string {
  return `${origin}/dock.html`;
}
