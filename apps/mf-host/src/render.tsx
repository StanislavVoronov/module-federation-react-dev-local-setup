import { StrictMode, type ComponentType } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';

export function render(MainApp: ComponentType): void {
  const container = document.getElementById('root');

  if (!container) {
    throw new Error('mf-host: #root не найден в разметке страницы');
  }

  const router = createBrowserRouter([
    {
      path: '/*',
      element: <MainApp />,
    },
  ]);

  createRoot(container).render(
    <StrictMode>
      <RouterProvider router={router} />
    </StrictMode>,
  );
}
