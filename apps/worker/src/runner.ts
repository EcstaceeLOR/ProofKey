import type { RelayJob } from './types.js';

export interface RelayRunner {
  process(transactionHash: string): Promise<RelayJob>;
}
