import type { RelayJob } from './flow.js';

export class ProofWorkerClient {
  constructor(private readonly baseUrl: string) {}

  async get(transactionHash: string): Promise<RelayJob> {
    const response = await fetch(`${this.baseUrl}/jobs/${transactionHash}`);
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
    const body = (await response.json()) as RelayJob & { error?: string };
    if (!response.ok)
      throw new Error(body.error ?? `Worker returned HTTP ${response.status}.`);
    return body;
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
