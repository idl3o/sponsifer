import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { ACCENT_OPTIONS } from '../../domain/board';
import {
  CORNERS,
  DEFAULT_ART,
  EMBLEM_INSET,
  EMBLEM_SIZE,
  PLACEMENTS,
  RESHOW_OPTIONS,
  SHAPES,
  WORDINGS,
  emblemGeometry,
  emblemView,
  sizeFromHeight,
  snapToCorner,
  type EmblemView,
  type PlacementKind,
} from '../../domain/emblem';
import type { Deal, EmblemStyle, SponsorArt } from '../../domain/types';
import { workspaceOf } from '../../domain/workspace';
import { useStore } from '../../store/useStore';
import { Segmented } from '../board/BoardEditor';
import { readBoardImage } from '../board/files';
import { Button, Pill, SelectField } from '../ui/Primitives';
import { EmblemBadge } from './EmblemBadge';

/**
 * The emblem, edited by hand.
 *
 * The preview is a 16:9 frame and the badge in it is the real EmblemBadge at
 * that frame's height, so what the creator drags is what OBS draws. Dragging
 * snaps to the nearest corner with an inset; a handle sets the size. The
 * style is the creator's and applies to every deal; the image, wording and
 * brand colour are this sponsor's.
 */

/** The frame's rendered height, which the badge scales from. */
function useFrameHeight(ref: React.RefObject<HTMLDivElement | null>): number {
  const [height, setHeight] = useState(270);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (typeof ResizeObserver === 'undefined') {
      setHeight(el.clientHeight || 270);
      return;
    }
    const observer = new ResizeObserver(([entry]) => entry && setHeight(entry.contentRect.height));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return height;
}

type Place = (patch: Partial<EmblemStyle>) => void;

/** The preview: a stream frame with the badge draggable inside it. */
function Frame({ view, shot, place }: { view: EmblemView; shot: string; place: Place }) {
  const ref = useRef<HTMLDivElement>(null);
  const frameHeight = useFrameHeight(ref);

  const track = (onMove: (e: PointerEvent, rect: DOMRect) => void) => (start: ReactPointerEvent) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    start.preventDefault();
    start.stopPropagation();
    const move = (e: PointerEvent) => onMove(e, rect);
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
  };

  const drag = track((e, rect) => {
    const point = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    place(snapToCorner(point, { w: rect.width, h: rect.height }));
  });
  const resize = track((e, rect) => {
    const g = emblemGeometry(view.style, rect.height);
    const fromTop = view.style.corner.startsWith('top');
    const edge = fromTop ? rect.top + g.insetPx : rect.bottom - g.insetPx;
    place({ size: sizeFromHeight(Math.abs(e.clientY - edge), rect.height) });
  });

  return (
    <div ref={ref} className={`emblem-frame${shot ? '' : ' mock'}`} aria-label="Stream preview">
      {shot && <img className="frame-shot" src={shot} alt="" draggable={false} />}
      {view.kind === 'emblem' ? (
        <EmblemBadge view={view} frameHeight={frameHeight} onPointerDown={drag}>
          <span className="emblem-handle" aria-label="Resize" onPointerDown={resize} />
        </EmblemBadge>
      ) : (
        <EmblemBadge view={view} frameHeight={frameHeight} />
      )}
    </div>
  );
}

/** Where it sits, how big, and what shape. */
function PlaceFields({ style, place }: { style: EmblemStyle; place: Place }) {
  return (
    <>
      <Segmented label="Corner" value={style.corner} options={[...CORNERS]} onChange={(corner) => place({ corner })} />
      <label className="field">
        <span className="lbl">Size</span>
        <input type="range" min={EMBLEM_SIZE.min} max={EMBLEM_SIZE.max} step={0.005} value={style.size}
          onChange={(e) => place({ size: Number(e.target.value) })} />
        <span className="hint">A share of the stream's height, so it scales with the source.</span>
      </label>
      <label className="field">
        <span className="lbl">Inset from the corner</span>
        <input type="range" min={EMBLEM_INSET.min} max={EMBLEM_INSET.max} step={2} value={style.inset}
          onChange={(e) => place({ inset: Number(e.target.value) })} />
      </label>
      <Segmented label="Shape" value={style.shape} options={[...SHAPES]} onChange={(shape) => place({ shape })} />
    </>
  );
}

/** A colour: the board's swatches, or any colour. */
function ColourField({ label, value, onChange }: { label: string; value: string; onChange: (c: string) => void }) {
  return (
    <div className="field">
      <span className="lbl">{label}</span>
      <div className="row" style={{ gap: 8 }}>
        {ACCENT_OPTIONS.map((c) => (
          <button key={c} type="button" className="swatch" aria-label={`${label} ${c}`} aria-pressed={value === c}
            style={{ background: c }} onClick={() => onChange(c)} />
        ))}
        <input type="color" aria-label={`Custom ${label.toLowerCase()}`} value={value} onChange={(e) => onChange(e.target.value)} className="swatch-custom" />
      </div>
    </div>
  );
}

/** Colours and motion. */
function LookFields({ style, place }: { style: EmblemStyle; place: Place }) {
  return (
    <>
      <ColourField label="Accent" value={style.accent} onChange={(accent) => place({ accent })} />
      <ColourField label="Background" value={style.background} onChange={(background) => place({ background })} />
      <ColourField label="Text" value={style.text} onChange={(text) => place({ text })} />
      <label className="check">
        <input type="checkbox" checked={style.bareLogo} onChange={(e) => place({ bareLogo: e.target.checked })} />
        <span>Image and label only, no line of text</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={style.entrance} onChange={(e) => place({ entrance: e.target.checked })} />
        <span>Slide in when the source appears</span>
      </label>
      <SelectField label="Re-show the label" value={String(style.reshowEveryMinutes)}
        options={RESHOW_OPTIONS.map((m) => ({ value: String(m), label: m === 0 ? 'Never' : `Every ${m} minutes` }))}
        onChange={(v) => place({ reshowEveryMinutes: Number(v) })}
        hint="A brief pulse, so a viewer who joined late still sees that this is an ad. The FTC asks for exactly this on live streams." />
    </>
  );
}

/** The sponsor's part: their image, the wording, and their colour. */
function ArtFields({ deal }: { deal: Deal }) {
  const setSponsorArt = useStore((s) => s.setSponsorArt);
  const art = deal.sponsorArt ?? DEFAULT_ART;
  const set = (patch: Partial<SponsorArt>) => setSponsorArt(deal.id, { ...art, ...patch });
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState('');
  const upload = (file: File) =>
    void readBoardImage(file, 480).then((result) => {
      if (result.ok) set({ image: result.image, imageAspect: result.aspect });
      setProblem(result.ok ? '' : result.message);
    });
  return (
    <>
      <div className="upload">
        <div className="row" style={{ gap: 6 }}>
          <Button onClick={() => input.current?.click()}>{art.image ? 'Replace image' : "Upload the sponsor's image"}</Button>
          {art.image && <Button variant="ghost" onClick={() => set({ image: '', imageAspect: 0 })}>Remove image</Button>}
        </div>
        <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" style={{ display: 'none' }}
          onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ''; }} />
        <span className="hint">Their logo, ideally on a transparent background. It sits beside the Ad label and cannot replace it.</span>
        {problem && <Pill tone="bad">{problem}</Pill>}
      </div>
      <Segmented label="Wording" value={art.wording} options={[...WORDINGS]} onChange={(wording) => set({ wording })} />
      <label className="check">
        <input type="checkbox" checked={art.accent !== null} onChange={(e) => set({ accent: e.target.checked ? '#e2b658' : null })} />
        <span>Use the sponsor's own colour for the label</span>
      </label>
      {art.accent !== null && <ColourField label="Sponsor colour" value={art.accent} onChange={(accent) => set({ accent })} />}
    </>
  );
}

/** The emblem for one won deal: the live frame, the house style, and the sponsor's art. */
export function EmblemEditor({ deal }: { deal: Deal }) {
  const profile = useStore((s) => s.profile);
  const terms = useStore((s) => s.terms);
  const prospects = useStore((s) => s.prospects);
  const deals = useStore((s) => s.deals);
  const board = useStore((s) => s.board);
  const emblem = useStore((s) => s.emblem);
  const setEmblem = useStore((s) => s.setEmblem);
  const [shot, setShot] = useState('');
  const [kind, setKind] = useState<PlacementKind>('emblem');
  const shotInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => void (shot.startsWith('blob:') && URL.revokeObjectURL(shot)), [shot]);

  const view = emblemView(workspaceOf({ profile, terms, prospects, deals, board, emblem }), deal.id, kind);
  if (!view) return null;
  return (
    <div className="emblem-editor">
      <div>
        <Segmented label="Placement" value={kind} options={PLACEMENTS.map((p) => ({ value: p.value, label: p.label }))} onChange={setKind} />
        <Frame view={view} shot={shot} place={setEmblem} />
        <div className="row" style={{ gap: 6, marginTop: 8 }}>
          <Button onClick={() => shotInput.current?.click()}>Try on your own frame</Button>
          {shot && <Button variant="ghost" onClick={() => setShot('')}>Clear</Button>}
          <input ref={shotInput} type="file" accept="image/*" style={{ display: 'none' }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) setShot(URL.createObjectURL(f)); e.target.value = ''; }} />
        </div>
        <p className="note">
          {kind === 'emblem'
            ? 'Drag the badge to a corner; drag its handle to size it.'
            : `${PLACEMENTS.find((p) => p.value === kind)?.hint ?? ''} It takes its colours, shape and size from your house style.`}{' '}
          The frame is a stand-in; what is drawn in it is exactly what OBS draws.
        </p>
      </div>
      <div>
        <h3>Your house style</h3>
        <p className="note">Applies to every deal's overlay.</p>
        <PlaceFields style={emblem} place={setEmblem} />
        <LookFields style={emblem} place={setEmblem} />
        <h3>This sponsor</h3>
        <ArtFields deal={deal} />
      </div>
    </div>
  );
}
