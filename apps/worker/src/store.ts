import { Pool, type PoolConfig } from 'pg';
import type { DurableJobStore, RelayJob } from './types.js';

export interface PostgresJobStoreOptions {
  ssl?: boolean;
  tableName?: string;
}

export class PostgresJobStore implements DurableJobStore {
  private readonly pool: Pool;
  private readonly table: string;
  private readonly claimableIndex: string;
  private initialized?: Promise<void>;

  constructor(databaseUrl: string, options: PostgresJobStoreOptions = {}) {
    if (!databaseUrl.trim()) throw new Error('DATABASE_URL cannot be empty.');
    const tableName = options.tableName ?? 'proofkey_relay_jobs';
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(tableName))
      throw new Error('Relay database table name is invalid.');
    this.table = `"${tableName}"`;
    this.claimableIndex = `"${tableName}_claimable_idx"`;
    const config: PoolConfig = {
      connectionString: databaseUrl,
      max: 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
      application_name: 'proofkey-relay',
    };
    if (options.ssl) config.ssl = { rejectUnauthorized: false };
    this.pool = new Pool(config);
  }

  async initialize(): Promise<void> {
    this.initialized ??= this.migrate();
    return this.initialized;
  }

  async get(sourceTransactionHash: string): Promise<RelayJob | undefined> {
    await this.initialize();
    const result = await this.pool.query<{ job: RelayJob }>(
      `SELECT job FROM ${this.table} WHERE source_transaction_hash = $1`,
      [sourceTransactionHash.toLowerCase()],
    );
    return result.rows[0]?.job;
  }

  async create(job: RelayJob): Promise<{ job: RelayJob; created: boolean }> {
    await this.initialize();
    const result = await this.pool.query<{ job: RelayJob }>(
      `INSERT INTO ${this.table}
        (source_transaction_hash, phase, job)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (source_transaction_hash) DO NOTHING
       RETURNING job`,
      [job.sourceTransactionHash.toLowerCase(), job.phase, JSON.stringify(job)],
    );
    if (result.rows[0]) return { job: result.rows[0].job, created: true };
    const existing = await this.get(job.sourceTransactionHash);
    if (!existing) throw new Error('Relay job disappeared during enqueue.');
    return { job: existing, created: false };
  }

  async save(job: RelayJob): Promise<void> {
    await this.initialize();
    await this.pool.query(
      `INSERT INTO ${this.table}
        (source_transaction_hash, phase, job)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (source_transaction_hash) DO UPDATE SET
         phase = EXCLUDED.phase,
         job = EXCLUDED.job,
         updated_at = NOW()`,
      [job.sourceTransactionHash.toLowerCase(), job.phase, JSON.stringify(job)],
    );
  }

  async claimNext(
    ownerId: string,
    leaseDurationMs: number,
  ): Promise<RelayJob | undefined> {
    await this.initialize();
    const result = await this.pool.query<{ job: RelayJob }>(
      `WITH candidate AS (
         SELECT source_transaction_hash
         FROM ${this.table}
         WHERE phase NOT IN ('completed', 'duplicate', 'failed')
           AND available_at <= NOW()
           AND (lease_expires_at IS NULL OR lease_expires_at < NOW())
         ORDER BY created_at
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       UPDATE ${this.table} AS jobs
       SET lease_owner = $1,
           lease_expires_at = NOW() + ($2 * INTERVAL '1 millisecond'),
           updated_at = NOW()
       FROM candidate
       WHERE jobs.source_transaction_hash = candidate.source_transaction_hash
       RETURNING jobs.job`,
      [ownerId, leaseDurationMs],
    );
    return result.rows[0]?.job;
  }

  async renewLease(
    sourceTransactionHash: string,
    ownerId: string,
    leaseDurationMs: number,
  ): Promise<boolean> {
    await this.initialize();
    const result = await this.pool.query(
      `UPDATE ${this.table}
       SET lease_expires_at = NOW() + ($3 * INTERVAL '1 millisecond'),
           updated_at = NOW()
       WHERE source_transaction_hash = $1 AND lease_owner = $2`,
      [sourceTransactionHash.toLowerCase(), ownerId, leaseDurationMs],
    );
    return result.rowCount === 1;
  }

  async release(sourceTransactionHash: string, ownerId: string): Promise<void> {
    await this.initialize();
    await this.pool.query(
      `UPDATE ${this.table}
       SET lease_owner = NULL, lease_expires_at = NULL, updated_at = NOW()
       WHERE source_transaction_hash = $1 AND lease_owner = $2`,
      [sourceTransactionHash.toLowerCase(), ownerId],
    );
  }

  async isReady(): Promise<boolean> {
    try {
      await this.initialize();
      await this.pool.query('SELECT 1');
      return true;
    } catch {
      return false;
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async migrate(): Promise<void> {
    await this.pool.query(
      `CREATE TABLE IF NOT EXISTS ${this.table} (
        source_transaction_hash VARCHAR(66) PRIMARY KEY,
        phase VARCHAR(32) NOT NULL,
        job JSONB NOT NULL,
        available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        lease_owner TEXT,
        lease_expires_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT source_transaction_hash_format
          CHECK (source_transaction_hash ~ '^0x[0-9a-f]{64}$')
      )`,
    );
    await this.pool.query(
      `CREATE INDEX IF NOT EXISTS ${this.claimableIndex}
       ON ${this.table} (available_at, created_at)
       WHERE phase NOT IN ('completed', 'duplicate', 'failed')`,
    );
  }
}
