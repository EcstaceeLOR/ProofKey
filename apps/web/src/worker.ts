import type { RelayJob } from './flow.js';

export function normalizeProofWorkerUrl(
  value: string | undefined,
  production: boolean,
): string {
  const normalized = (value?.trim() ?? '').replace(/\/$/, '');
  let url: URL;
  try {
    url = new URL(normalized);
  } catch {
    throw new Error('Set VITE_PROOF_WORKER_URL to the public relay URL.');
  }
  if (
    production &&
    (url.protocol !== 'https:' ||
      ['localhost', '127.0.0.1', '::1'].includes(url.hostname))
  )
    throw new Error('Production requires a public HTTPS proof relay URL.');
  return normalized;
}

export class ProofWorkerClient {
  constructor(private readonly baseUrl: string) {}

  async get(transactionHash: string): Promise<RelayJob> {
    const response = await fetch(`${this.baseUrl}/jobs/${transactionHash}`);
    return this.parse(response);
  }

  async find(transactionHash: string): Promise<RelayJob | undefined> {
    const response = await fetch(`${this.baseUrl}/jobs/${transactionHash}`);
    if (response.status === 404) return undefined;
    return this.parse(response);
  }

  async enqueue(transactionHash: string): Promise<RelayJob> {
    const response = await fetch(`${this.baseUrl}/jobs`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ transactionHash }),
    });
    return this.parse(response);
  }

  async waitForCompletion(
    transactionHash: string,
    onUpdate: (job: RelayJob) => void,
    signal?: AbortSignal,
  ): Promise<RelayJob> {
    const deadline = Date.now() + 45 * 60 * 1_000;
    while (Date.now() < deadline) {
      if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
      const response = await fetch(`${this.baseUrl}/jobs/${transactionHash}`, {
        signal,
      });
      const job = await this.parse(response);
      onUpdate(job);
      if (job.phase === 'completed' || job.phase === 'duplicate') return job;
      if (job.phase === 'failed')
        throw new Error(job.error ?? 'Proof relay failed.');
      await delay(2_000, signal);
    }
    throw new Error(
      'Proof relay did not complete within 45 minutes. You can safely resume later.',
    );
  }

  private async parse(response: Response): Promise<RelayJob> {
    const body = (await response.json()) as Omit<RelayJob, 'error'> & {
      error?: string | { code: string; message: string; retryable: boolean };
    };
    if (!response.ok) {
      const error = body.error;
      const message =
        typeof error === 'string'
          ? error
          : (error?.message ?? `Worker returned HTTP ${response.status}.`);
      throw new Error(message);
    }
    return body as RelayJob;
  }
}

function delay(milliseconds: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        window.clearTimeout(timeout);
        reject(new DOMException('Cancelled', 'AbortError'));
      },
      { once: true },
    );
  });
}
