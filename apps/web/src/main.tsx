import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { AppProviders } from './app/AppProviders.js';
import { router } from './app/router.js';
import './styles.css';

const root = document.querySelector('#root');
if (!root) throw new Error('ProofKey could not find its application root.');

createRoot(root).render(
  <StrictMode>
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  </StrictMode>,
);
