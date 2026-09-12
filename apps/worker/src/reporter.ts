import type { RelayStatus, StatusReporter } from './types.js';

export class JsonConsoleReporter implements StatusReporter {
  report(status: RelayStatus): void {
    process.stdout.write(`${JSON.stringify(status)}\n`);
  }
}
