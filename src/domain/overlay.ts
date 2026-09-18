import { emblemView, type EmblemView } from './emblem';
import type { Workspace } from './workspace';

/**
 * What the OBS overlay draws for a won deal: the sponsor emblem, composed in
 * `emblem.ts`. This module keeps the overlay's address and its one rule, that
 * the view carries the disclosure and never a price.
 */
export type OverlayView = EmblemView;

/** The overlay for a deal: only a won deal is on air. Null for a lost or unknown deal. */
export function overlayFor(workspace: Workspace, dealId: string): OverlayView | null {
  return emblemView(workspace, dealId);
}

/**
 * The address OBS loads for a deal's overlay, on the server that serves the
 * app. The file name, not the server's `/overlay` alias, so the same address
 * works under Vite in development.
 */
export function overlayUrl(origin: string, dealId: string): string {
  return `${origin}/overlay.html?deal=${encodeURIComponent(dealId)}`;
}
