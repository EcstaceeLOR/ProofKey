import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { PublicProofEvidence, RelayJob } from './types.js';

const secretFieldPattern =
  /^(?:api[-_]?key|database[-_]?url|deployer[-_]?private[-_]?key|internal[-_]?path|mnemonic|password|private[-_]?key|rpc[-_]?url|secret|worker[-_]?private[-_]?key)$/i;

export function assertPublicEvidence(value: unknown, path = '$'): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertPublicEvidence(entry, `${path}[${index}]`),
    );
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [key, entry] of Object.entries(value)) {
    if (secretFieldPattern.test(key)) {
      throw new Error(
        `Refusing to persist secret-bearing field ${path}.${key}.`,
      );
    }
    assertPublicEvidence(entry, `${path}.${key}`);
  }
}

export async function writePublicEvidence(
  outputPath: string,
  value: unknown,
): Promise<void> {
  assertPublicEvidence(value);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

export function publicEvidenceFromJob(job: RelayJob): PublicProofEvidence {
  const evidence: PublicProofEvidence = {
    schema: 'proofkey.public-proof.v1',
    source: {
      transactionHash: job.sourceTransactionHash,
      blockNumber: job.sourceBlockNumber,
      payment: job.sourcePayment,
    },
    relay: {
      phase: job.phase,
      createdAt: job.createdAt,
      updatedAt: job.updatedAt,
      attempts: job.attempts,
      failedAtPhase: job.failedAtPhase,
      failure: job.failure,
    },
    attestcoin: job.proof,
    creditcoin: {
      transactionHash: job.creditcoinTransactionHash,
      queryId: job.queryId,
      accessExpiresAt: job.accessExpiresAt,
    },
  };
  assertPublicEvidence(evidence);
  return evidence;
}
