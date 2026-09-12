import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { JobStore, RelayJob } from './types.js';

interface JobFile {
  version: 1;
  jobs: Record<string, RelayJob>;
}

export class JsonJobStore implements JobStore {
  private writeQueue: Promise<void> = Promise.resolve();
  constructor(private readonly filePath: string) {}

  async get(sourceTransactionHash: string): Promise<RelayJob | undefined> {
    return (await this.read()).jobs[sourceTransactionHash.toLowerCase()];
  }

  async save(job: RelayJob): Promise<void> {
    this.writeQueue = this.writeQueue.then(async () => {
      const data = await this.read();
      data.jobs[job.sourceTransactionHash.toLowerCase()] = job;
      await mkdir(dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.${process.pid}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      });
      await rename(temporaryPath, this.filePath);
    });
    return this.writeQueue;
  }

  private async read(): Promise<JobFile> {
    try {
      const parsed = JSON.parse(
        await readFile(this.filePath, 'utf8'),
      ) as JobFile;
      if (parsed.version !== 1 || typeof parsed.jobs !== 'object')
        throw new Error('unsupported job-store format');
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { version: 1, jobs: {} };
      throw error;
    }
  }
}
