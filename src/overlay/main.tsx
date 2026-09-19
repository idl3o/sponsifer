import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { placementKind } from '../domain/emblem';
import { Overlay } from './Overlay';
import './overlay.css';

const params = new URLSearchParams(window.location.search);
const dealId = params.get('deal') ?? '';
const root = document.getElementById('overlay');
if (root && dealId) {
  createRoot(root).render(
    <StrictMode>
      <Overlay dealId={dealId} kind={placementKind(params.get('kind'))} fetcher={window.fetch.bind(window)} />
    </StrictMode>,
  );
}
