import type { AppConfig } from './contracts.js';
import {
  clientFault,
  reportClientFault,
  type ClientArea,
} from './telemetry.js';

export type DiagnosticStatus = 'ready' | 'degraded' | 'unavailable';

export interface DiagnosticCheck {
  id: 'configuration' | 'relay' | 'sepolia' | 'creditcoin';
  label: string;
  status: DiagnosticStatus;
  code: string;
  latencyMs: number;
  detail: string;
}

export interface DiagnosticSnapshot {
  status: DiagnosticStatus;
  checkedAt: string;
  checks: DiagnosticCheck[];
}

export async function runDiagnostics(
  config: AppConfig,
): Promise<DiagnosticSnapshot> {
  const checks = await Promise.all([
    Promise.resolve({
      id: 'configuration' as const,
      label: 'Public configuration',
      status: 'ready' as const,
      code: 'CONFIGURATION_READY',
      latencyMs: 0,
      detail: 'Required public contract addresses and HTTPS services loaded.',
    }),
    relayCheck(config.workerUrl),
    rpcCheck(
      'sepolia',
      'Ethereum Sepolia RPC',
      config.sepoliaRpcUrl,
      11155111n,
    ),
    rpcCheck(
      'creditcoin',
      'Creditcoin CC3 RPC',
      config.creditcoinRpcUrl,
      102031n,
    ),
  ]);
  return {
    status: checks.some((check) => check.status === 'unavailable')
      ? 'unavailable'
      : checks.some((check) => check.status === 'degraded')
        ? 'degraded'
        : 'ready',
    checkedAt: new Date().toISOString(),
    checks,
  };
}

async function relayCheck(workerUrl: string): Promise<DiagnosticCheck> {
  return timedCheck('relay', 'Attestcoin relay', 'relay', async () => {
    const [health, readiness] = await Promise.all([
      fetch(`${workerUrl}/health`, { cache: 'no-store' }),
      fetch(`${workerUrl}/ready`, { cache: 'no-store' }),
    ]);
    if (!health.ok) throw new Error('RELAY_HEALTH_HTTP_ERROR');
    const body = (await readiness.json().catch(() => undefined)) as
      { status?: string } | undefined;
    if (!readiness.ok || body?.status !== 'ready')
      return {
        status: 'degraded' as const,
        code: 'RELAY_NOT_READY',
        detail: 'Relay is alive but one or more readiness checks are degraded.',
      };
    return {
      status: 'ready' as const,
      code: 'RELAY_READY',
      detail: 'Relay API, database, RPCs, and relayer report ready.',
    };
  });
}

async function rpcCheck(
  id: 'sepolia' | 'creditcoin',
  label: string,
  url: string,
  expectedChainId: bigint,
): Promise<DiagnosticCheck> {
  return timedCheck(id, label, `${id}_rpc` as ClientArea, async () => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'eth_chainId',
        params: [],
      }),
    });
    const body = (await response.json()) as { result?: string };
    if (!response.ok || !body.result)
      throw new Error(`${id.toUpperCase()}_RPC_HTTP_ERROR`);
    if (BigInt(body.result) !== expectedChainId)
      throw new Error(`${id.toUpperCase()}_CHAIN_MISMATCH`);
    return {
      status: 'ready' as const,
      code: `${id.toUpperCase()}_RPC_READY`,
      detail: `Chain ID ${expectedChainId} verified without a wallet.`,
    };
  });
}

async function timedCheck(
  id: DiagnosticCheck['id'],
  label: string,
  area: ClientArea,
  run: () => Promise<Pick<DiagnosticCheck, 'status' | 'code' | 'detail'>>,
): Promise<DiagnosticCheck> {
  const started = performance.now();
  try {
    return {
      id,
      label,
      ...(await withTimeout(run(), 8_000)),
      latencyMs: Math.round(performance.now() - started),
    };
  } catch (error) {
    const code =
      error instanceof Error && /^[A-Z0-9_]+$/.test(error.message)
        ? error.message
        : `${id.toUpperCase()}_UNAVAILABLE`;
    reportClientFault(clientFault(code, area, true));
    return {
      id,
      label,
      status: 'unavailable',
      code,
      latencyMs: Math.round(performance.now() - started),
      detail:
        'The service could not be verified. Dependent actions fail safely.',
    };
  }
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      globalThis.setTimeout(
        () => reject(new Error('DIAGNOSTIC_TIMEOUT')),
        milliseconds,
      ),
    ),
  ]);
}
