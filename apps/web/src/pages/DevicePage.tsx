import {
  Check,
  Clock3,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  RadioTower,
  ShieldAlert,
  ShieldCheck,
  Square,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import { useRuntime } from '../app/AppProviders.js';
import { DataState, PageHeading } from '../components/ProductUI.js';
import {
  CreditcoinDeviceReader,
  DeviceHandoffClient,
  deriveDeviceSession,
  deviceClaimStorageKey,
  signUsageReceipt,
  switchDeviceWalletToCreditcoin,
  verifyUsageReceipt,
  type DeviceAuthorization,
  type DeviceHandoff,
} from '../device-session.js';
import { compactHash } from '../product.js';

const stateCopy = {
  awaiting_authorization: 'Awaiting authorization',
  unlocked: 'Verified · ready',
  active: 'Session active',
  expiring: 'Access expiring',
  expired: 'Access expired',
  stopped: 'Session stopped',
  fail_closed: 'Fail-closed lock',
};

export function Component() {
  const { machineId = '' } = useParams();
  const [params] = useSearchParams();
  const nonce = params.get('handoff') ?? '';
  const boundPayer = params.get('payer') ?? '';
  const runtime = useRuntime();
  const client = useMemo(
    () => runtime.config && new DeviceHandoffClient(runtime.config.workerUrl),
    [runtime.config],
  );
  const reader = useMemo(
    () => runtime.config && new CreditcoinDeviceReader(runtime.config),
    [runtime.config],
  );
  const [handoff, setHandoff] = useState<DeviceHandoff>();
  const [claimToken, setClaimToken] = useState<string>();
  const [authorization, setAuthorization] = useState<DeviceAuthorization>();
  const [rpcError, setRpcError] = useState<string>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1_000));

  useEffect(() => {
    if (!client || !/^[0-9a-fA-F]{64}$/.test(nonce)) return;
    const key = deviceClaimStorageKey(nonce);
    const storedToken = localStorage.getItem(key);
    setBusy(true);
    const request = client.get(nonce).then(async (record) => {
      if (record.machineId.toLowerCase() !== machineId.toLowerCase())
        throw new Error(
          'QR is bound to a different machine. Device remains locked.',
        );
      if (record.payer.toLowerCase() !== boundPayer.toLowerCase())
        throw new Error(
          'QR is bound to a different payer. Device remains locked.',
        );
      return storedToken
        ? { handoff: record, claimToken: storedToken }
        : client.claim(nonce);
    });
    void request
      .then((claimed) => {
        localStorage.setItem(key, claimed.claimToken);
        setClaimToken(claimed.claimToken);
        setHandoff(claimed.handoff);
      })
      .catch((caught: unknown) =>
        setError(caught instanceof Error ? caught.message : String(caught)),
      )
      .finally(() => setBusy(false));
  }, [boundPayer, client, machineId, nonce]);

  useEffect(() => {
    if (!reader || !handoff) return;
    let active = true;
    const inspect = async () => {
      try {
        const next = await reader.read(handoff.machineId, handoff.payer);
        if (!active) return;
        setAuthorization(next);
        setRpcError(undefined);
        setNow(next.blockTimestamp);
      } catch (caught) {
        if (!active) return;
        setRpcError(caught instanceof Error ? caught.message : String(caught));
      }
    };
    void inspect();
    const poll = window.setInterval(() => void inspect(), 4_000);
    return () => {
      active = false;
      window.clearInterval(poll);
    };
  }, [handoff?.machineId, handoff?.payer, reader]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow((value) => value + 1), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  async function sign(kind: 'start' | 'end') {
    if (
      !runtime.walletProvider ||
      !runtime.account ||
      !handoff ||
      !authorization ||
      !claimToken ||
      !client
    )
      return;
    setBusy(true);
    setError(undefined);
    try {
      await switchDeviceWalletToCreditcoin(runtime.walletProvider);
      const receipt = await signUsageReceipt(
        runtime.walletProvider,
        runtime.account,
        handoff,
        authorization.controller,
        kind,
        authorization.blockTimestamp,
      );
      if (!verifyUsageReceipt(receipt, handoff, authorization.controller).valid)
        throw new Error('Local controller signature verification failed.');
      setHandoff(
        await client.submitReceipt(handoff.nonce, claimToken, receipt),
      );
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  if (
    !nonce ||
    !/^[0-9a-fA-F]{64}$/.test(nonce) ||
    !/^0x[0-9a-fA-F]{40}$/.test(boundPayer)
  )
    return (
      <div className="route-page">
        <DataState
          kind="empty"
          title="Secure handoff required"
          copy="Open this terminal from the one-time QR in My Rentals."
        />
      </div>
    );
  if (error && !handoff)
    return (
      <div className="route-page">
        <DataState
          kind="offline"
          title="Device stayed locked"
          copy={error}
          action={
            <Link className="button secondary" to="/activity">
              Return to rentals
            </Link>
          }
        />
      </div>
    );
  if (!handoff || (busy && !authorization))
    return (
      <div className="route-page">
        <DataState
          kind="loading"
          title="Claiming one-time handoff"
          copy="Binding this browser to the QR nonce. A replay will be rejected."
        />
      </div>
    );

  const invalidReceipt = authorization
    ? [handoff.startReceipt, handoff.endReceipt]
        .filter((receipt) => Boolean(receipt))
        .map((receipt) =>
          verifyUsageReceipt(receipt!, handoff, authorization.controller),
        )
        .find((result) => !result.valid)
    : undefined;
  const derived = deriveDeviceSession(
    handoff,
    authorization,
    now,
    invalidReceipt?.reason ?? rpcError,
  );
  const controllerMatches = Boolean(
    runtime.account &&
    authorization &&
    runtime.account.toLowerCase() === authorization.controller.toLowerCase(),
  );
  const remaining = Math.max(0, Number(handoff.accessExpiresAt) - now);

  return (
    <div className={`route-page device-terminal state-${derived.state}`}>
      <PageHeading
        eyebrow="PROOFKEY MACHINE TERMINAL"
        title="Independent access control."
        copy="This terminal trusts Creditcoin state and the registered controller—not the customer browser or a cached success screen."
        action={
          <span className="terminal-network">
            <RadioTower size={14} /> CC3 · block{' '}
            {authorization?.blockNumber ?? '—'}
          </span>
        }
      />
      <div className="terminal-grid">
        <section className="terminal-lock-panel">
          <div className="terminal-lock-orbit">
            <span />
            <span />
            <div>
              {['unlocked', 'active', 'expiring'].includes(derived.state) ? (
                <KeyRound size={48} />
              ) : (
                <LockKeyhole size={48} />
              )}
            </div>
          </div>
          <span className={`terminal-state ${derived.state}`}>
            {stateCopy[derived.state]}
          </span>
          <h2>
            {derived.state === 'active'
              ? 'Equipment enabled'
              : derived.state === 'unlocked'
                ? 'Ready for controller start'
                : 'Equipment output disabled'}
          </h2>
          <p>{derived.reason}</p>
          {(derived.state === 'active' || derived.state === 'expiring') && (
            <div className="session-clock">
              <Clock3 size={18} />
              <strong>{formatClock(remaining)}</strong>
              <span>verified time remaining</span>
            </div>
          )}
          {derived.state === 'unlocked' && controllerMatches && (
            <button
              className="terminal-action start"
              type="button"
              disabled={busy}
              onClick={() => void sign('start')}
            >
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <Check size={18} />
              )}{' '}
              Sign start & enable machine
            </button>
          )}
          {handoff.startReceipt && !handoff.endReceipt && controllerMatches && (
            <button
              className="terminal-action stop"
              type="button"
              disabled={busy}
              onClick={() => void sign('end')}
            >
              {busy ? (
                <LoaderCircle className="spin" size={18} />
              ) : (
                <Square size={16} />
              )}{' '}
              Stop & sign usage receipt
            </button>
          )}
        </section>

        <section className="terminal-audit-panel">
          <div className="terminal-audit-head">
            <div>
              <p className="eyebrow">LIVE SAFETY INTERLOCKS</p>
              <h2>Every binding must pass</h2>
            </div>
            <ShieldCheck size={24} />
          </div>
          <AuditRow
            ok={handoff.machineId.toLowerCase() === machineId.toLowerCase()}
            label="QR machine binding"
            value={compactHash(machineId, 10, 8)}
          />
          <AuditRow
            ok={
              authorization?.authorizationId.toLowerCase() ===
              handoff.orderId.toLowerCase()
            }
            label="AccessPass order"
            value={compactHash(handoff.orderId, 10, 8)}
          />
          <AuditRow
            ok={authorization?.authorized === true}
            label="Payer authorization"
            value={compactHash(handoff.payer, 9, 6)}
          />
          <AuditRow
            ok={authorization?.machineActive === true}
            label="Machine registry"
            value={
              authorization?.machineActive ? 'Active' : 'Inactive / unknown'
            }
          />
          <AuditRow
            ok={!rpcError && Boolean(authorization)}
            label="CC3 heartbeat"
            value={rpcError ? 'RPC failed · locked' : '4-second direct read'}
          />
          <AuditRow
            ok={controllerMatches}
            label="Controller wallet"
            value={
              runtime.account
                ? compactHash(runtime.account, 9, 6)
                : 'Not connected'
            }
          />

          <div className="controller-gate">
            {!runtime.account ? (
              <button
                className="button primary wide"
                type="button"
                onClick={runtime.openWallet}
              >
                Connect controller wallet
              </button>
            ) : !controllerMatches ? (
              <div className="inline-alert">
                <ShieldAlert size={16} />
                <span>
                  Reconnect registered controller{' '}
                  {authorization && compactHash(authorization.controller, 9, 6)}
                  .
                </span>
              </div>
            ) : (
              <div className="controller-confirmed">
                <ShieldCheck size={16} />
                <span>Registered controller connected</span>
              </div>
            )}
          </div>
          {error && (
            <div className="inline-alert" role="alert">
              {error}
            </div>
          )}
          <div className="terminal-receipts">
            <ReceiptStatus
              label="Start receipt"
              present={Boolean(handoff.startReceipt)}
            />
            <ReceiptStatus
              label="End receipt"
              present={Boolean(handoff.endReceipt)}
            />
          </div>
        </section>
      </div>
    </div>
  );
}

function AuditRow({
  ok,
  label,
  value,
}: {
  ok: boolean;
  label: string;
  value: string;
}) {
  return (
    <div className={`terminal-audit-row ${ok ? 'pass' : 'fail'}`}>
      <span>{ok ? <Check size={12} /> : <ShieldAlert size={12} />}</span>
      <div>
        <strong>{label}</strong>
        <small>{value}</small>
      </div>
    </div>
  );
}

function ReceiptStatus({
  label,
  present,
}: {
  label: string;
  present: boolean;
}) {
  return (
    <div className={present ? 'present' : ''}>
      <span>{present ? <Check size={11} /> : ''}</span>
      <strong>{label}</strong>
      <small>{present ? 'signed + persisted' : 'not issued'}</small>
    </div>
  );
}

function formatClock(total: number) {
  const hours = Math.floor(total / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(
    2,
    '0',
  )}:${String(seconds).padStart(2, '0')}`;
}
