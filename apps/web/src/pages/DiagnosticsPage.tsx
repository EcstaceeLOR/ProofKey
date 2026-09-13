import {
  Activity,
  Check,
  CircleAlert,
  Clock3,
  RefreshCw,
  Server,
  ShieldCheck,
  WifiOff,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { useRuntime } from '../app/AppProviders.js';
import { DataState, PageHeading } from '../components/ProductUI.js';
import {
  runDiagnostics,
  type DiagnosticSnapshot,
  type DiagnosticStatus,
} from '../diagnostics.js';

export function Component() {
  const runtime = useRuntime();
  const [snapshot, setSnapshot] = useState<DiagnosticSnapshot>();
  const [checking, setChecking] = useState(false);

  async function inspect() {
    if (!runtime.config) return;
    setChecking(true);
    try {
      setSnapshot(await runDiagnostics(runtime.config));
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    void inspect();
  }, [runtime.config]);

  if (!runtime.config)
    return (
      <div className="route-page">
        <DataState
          kind="offline"
          title="Public configuration is incomplete"
          copy={runtime.configurationError ?? 'Required settings did not load.'}
        />
      </div>
    );

  return (
    <div className="route-page diagnostics-page">
      <PageHeading
        eyebrow="SYSTEM STATUS"
        title="Know what is live before you transact."
        copy="Privacy-safe, read-only checks verify both chains and the Attestcoin relay. No wallet, address, balance, or transaction identifier is sent to this page."
        action={
          <button
            className="button secondary"
            type="button"
            disabled={checking}
            onClick={() => void inspect()}
          >
            <RefreshCw className={checking ? 'spin' : ''} size={15} />
            Run checks
          </button>
        }
      />

      <section className={`diagnostic-hero ${snapshot?.status ?? 'checking'}`}>
        <div className="diagnostic-orbit">
          {snapshot?.status === 'ready' ? (
            <ShieldCheck size={46} />
          ) : snapshot ? (
            <CircleAlert size={46} />
          ) : (
            <Activity className="pulse" size={46} />
          )}
        </div>
        <div>
          <p className="eyebrow">CURRENT READINESS</p>
          <h2>{readinessTitle(snapshot?.status)}</h2>
          <p>
            {snapshot
              ? `Checked ${new Date(snapshot.checkedAt).toLocaleString()}`
              : 'Contacting public infrastructure…'}
          </p>
        </div>
      </section>

      <div className="diagnostic-grid" aria-live="polite">
        {(snapshot?.checks ?? []).map((check) => (
          <article className={check.status} key={check.id}>
            <div className="diagnostic-card-head">
              <span>
                {check.status === 'ready' ? (
                  <Check size={16} />
                ) : (
                  <WifiOff size={16} />
                )}
              </span>
              <small>{check.code}</small>
            </div>
            <Server size={22} />
            <h2>{check.label}</h2>
            <p>{check.detail}</p>
            <div>
              <Clock3 size={13} /> {check.latencyMs} ms
            </div>
          </article>
        ))}
        {!snapshot &&
          [0, 1, 2, 3].map((item) => (
            <div className="diagnostic-skeleton" key={item} />
          ))}
      </div>

      <section className="privacy-telemetry-note">
        <ShieldCheck size={20} />
        <div>
          <strong>Privacy-safe client telemetry</strong>
          <p>
            Failures emit only a stable code, service area, retryability,
            timestamp, and redacted route. Wallets, RPC URLs, errors, and public
            identifiers are excluded.
          </p>
        </div>
      </section>
    </div>
  );
}

function readinessTitle(status?: DiagnosticStatus) {
  if (!status) return 'Checking every dependency';
  if (status === 'ready') return 'ProofKey infrastructure is ready';
  if (status === 'degraded') return 'Some actions may be delayed';
  return 'Dependent actions are unavailable';
}
