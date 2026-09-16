import { StrictMode } from 'react';
import type { ComponentType } from 'react';
import { createRoot } from 'react-dom/client';

export function render(container: HTMLElement, App: ComponentType) {
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}
