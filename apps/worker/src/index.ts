export interface WorkerHealth {
  service: 'proofkey-worker';
  status: 'ready';
}

export function getWorkerHealth(): WorkerHealth {
  return { service: 'proofkey-worker', status: 'ready' };
}
