export type ClientArea =
  | 'render'
  | 'routing'
  | 'wallet'
  | 'sepolia_rpc'
  | 'creditcoin_rpc'
  | 'relay'
  | 'configuration';

export interface ClientFault {
  schema: 'proofkey.client-fault.v1';
  code: string;
  area: ClientArea;
  retryable: boolean;
  timestamp: string;
}

export function clientFault(
  code: string,
  area: ClientArea,
  retryable: boolean,
): ClientFault {
  return {
    schema: 'proofkey.client-fault.v1',
    code,
    area,
    retryable,
    timestamp: new Date().toISOString(),
  };
}

export function reportClientFault(
  fault: ClientFault,
  route = globalThis.location?.pathname ?? '/',
): void {
  const safeRoute = route.replace(
    /0x[0-9a-fA-F]{40,64}/g,
    ':public-identifier',
  );
  console.warn(
    JSON.stringify({
      ...fault,
      route: safeRoute,
    }),
  );
}

export function installGlobalTelemetry(): () => void {
  const onError = () =>
    reportClientFault(clientFault('UNHANDLED_WINDOW_ERROR', 'render', false));
  const onRejection = () =>
    reportClientFault(
      clientFault('UNHANDLED_PROMISE_REJECTION', 'render', false),
    );
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
