import { emblemView, type EmblemView, type PlacementKind } from './emblem';
import type { Workspace } from './workspace';

/**
 * What an OBS browser source draws for a won deal: one placement, composed in
 * `emblem.ts`. This module keeps the overlay's address and its one rule, that
 * the view carries the disclosure and never a price.
 */
export type OverlayView = EmblemView;

/** The placement for a deal: only a won deal is on air. Null for a lost or unknown deal. */
export function overlayFor(workspace: Workspace, dealId: string, kind: PlacementKind = 'emblem'): OverlayView | null {
  return emblemView(workspace, dealId, kind);
}

/**
 * The address OBS loads for one of a deal's placements, on the server that
 * serves the app. The file name, not the server's `/overlay` alias, so the
 * same address works under Vite in development. The corner emblem's address
 * names no kind, so addresses already pasted into OBS keep working.
 */
export function overlayUrl(origin: string, dealId: string, kind: PlacementKind = 'emblem'): string {
  const base = `${origin}/overlay.html?deal=${encodeURIComponent(dealId)}`;
  return kind === 'emblem' ? base : `${base}&kind=${kind}`;
}
