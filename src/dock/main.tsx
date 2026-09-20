import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Dock } from './Dock';
import '../styles/app.css';
import './dock.css';

const root = document.getElementById('dock');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Dock asked={new URLSearchParams(window.location.search).get('deal')} fetcher={window.fetch.bind(window)} />
    </StrictMode>,
  );
}
