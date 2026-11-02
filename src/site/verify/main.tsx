import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Verifier } from './Verifier';

const root = document.getElementById('verifier');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Verifier />
    </StrictMode>,
  );
}
