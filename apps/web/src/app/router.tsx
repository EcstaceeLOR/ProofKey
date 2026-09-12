import { createBrowserRouter } from 'react-router';
import { AppShell } from './AppShell.js';

export const router = createBrowserRouter([
  {
    path: '/',
    Component: AppShell,
    ErrorBoundary: () => <RouteError />,
    children: [
      { index: true, lazy: () => import('../pages/HomePage.js') },
      { path: 'explore', lazy: () => import('../pages/ExplorePage.js') },
      {
        path: 'machines/:machineId',
        lazy: () => import('../pages/MachinePage.js'),
      },
      { path: 'rent/:machineId', lazy: () => import('../pages/RentPage.js') },
      { path: 'activity', lazy: () => import('../pages/ActivityPage.js') },
      {
        path: 'proofs/:sourceTxHash',
        lazy: () => import('../pages/ProofPage.js'),
      },
      { path: 'operator', lazy: () => import('../pages/OperatorPage.js') },
      {
        path: 'device/:machineId',
        lazy: () => import('../pages/DevicePage.js'),
      },
      { path: '*', lazy: () => import('../pages/NotFoundPage.js') },
    ],
  },
]);

function RouteError() {
  return (
    <div className="fatal-route" role="alert">
      <span>PROOFKEY / ROUTE ERROR</span>
      <h1>This route could not be opened.</h1>
      <p>
        The application failed safely. Reload the page or return to the machine
        network.
      </p>
      <a href="/explore">Return to Explore</a>
    </div>
  );
}
