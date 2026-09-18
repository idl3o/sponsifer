import type { CSSProperties, PointerEventHandler, ReactNode } from 'react';
import { emblemGeometry, type EmblemView } from '../../domain/emblem';
import './emblem.css';

/**
 * The one renderer for the sponsor emblem.
 *
 * The editor's preview and the OBS browser source both draw this, at the
 * height of the frame they sit in, so what the creator drags into place is
 * what ships. Every dimension comes from `emblemGeometry`, which scales from
 * the frame's height alone; nothing here is measured in viewport units.
 *
 * The editor may attach a pointer handler and drop a resize handle inside;
 * neither changes a pixel of what is drawn. The "Ad" label is always
 * rendered. A view without it does not exist.
 */
export function EmblemBadge({
  view,
  frameHeight,
  onPointerDown,
  children,
}: {
  view: EmblemView;
  frameHeight: number;
  onPointerDown?: PointerEventHandler<HTMLDivElement>;
  children?: ReactNode;
}) {
  const g = emblemGeometry(view.style, frameHeight);
  const { style } = view;
  const classes = [
    'ad-badge',
    `ad-${g.corner}`,
    style.entrance ? 'ad-enter' : '',
    style.reshowEveryMinutes > 0 ? 'ad-reshow' : '',
  ].filter(Boolean).join(' ');
  const vars = {
    '--ad-accent': style.accent,
    '--ad-bg': style.background,
    '--ad-text': style.text,
    '--ad-h': `${g.heightPx}px`,
    '--ad-font': `${g.fontPx}px`,
    '--ad-radius': `${g.radiusPx}px`,
    '--ad-inset': `${g.insetPx}px`,
    '--ad-period': `${style.reshowEveryMinutes * 60}s`,
  } as CSSProperties;
  return (
    <div className={classes} style={vars} role="note" {...(onPointerDown ? { onPointerDown } : {})}>
      {view.image && <img className="ad-art" src={view.image} alt="" draggable={false} />}
      <span className="ad-label">{view.disclosure}</span>
      {view.line && <span className="ad-line">{view.line}</span>}
      {children}
    </div>
  );
}
