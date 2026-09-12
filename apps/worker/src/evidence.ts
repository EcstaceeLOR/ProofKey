import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

const secretFieldPattern =
  /^(?:api[-_]?key|deployer[-_]?private[-_]?key|mnemonic|password|private[-_]?key|rpc[-_]?url|secret|worker[-_]?private[-_]?key)$/i;

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
