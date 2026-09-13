import { useEffect } from 'react';
import { createBrowserRouter, useRouteError } from 'react-router';
import { clientFault, reportClientFault } from '../telemetry.js';
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
        path: 'sessions/:sourceTransactionHash',
        lazy: () => import('../pages/SessionPage.js'),
      },
      {
        path: 'proofs/:sourceTxHash',
        lazy: () => import('../pages/ProofPage.js'),
      },
      { path: 'operator', lazy: () => import('../pages/OperatorPage.js') },
      {
        path: 'diagnostics',
        lazy: () => import('../pages/DiagnosticsPage.js'),
      },
      {
        path: 'device/:machineId',
        lazy: () => import('../pages/DevicePage.js'),
      },
      { path: '*', lazy: () => import('../pages/NotFoundPage.js') },
    ],
  },
]);

function RouteError() {
  const error = useRouteError();
  useEffect(() => {
    reportClientFault(
      clientFault(
        error instanceof Response
          ? `ROUTE_HTTP_${error.status}`
          : 'ROUTE_RENDER_FAILURE',
        'routing',
        error instanceof Response && error.status >= 500,
      ),
    );
  }, [error]);
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
