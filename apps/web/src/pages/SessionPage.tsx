import {
  Check,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  LoaderCircle,
  QrCode,
  RefreshCw,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import QRCode from 'qrcode';
import { useRuntime } from '../app/AppProviders.js';
import { DataState, PageHeading } from '../components/ProductUI.js';
import {
  CreditcoinDeviceReader,
  DeviceHandoffClient,
  customerHandoffStorageKey,
  verifyUsageReceipt,
  type DeviceAuthorization,
  type DeviceHandoff,
  type SignedUsageReceipt,
} from '../device-session.js';
import { compactHash, proofPath } from '../product.js';

export function Component() {
  const { sourceTransactionHash = '' } = useParams();
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
  const [authorization, setAuthorization] = useState<DeviceAuthorization>();
  const [qrDataUrl, setQrDataUrl] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());

  const storageKey = customerHandoffStorageKey(sourceTransactionHash);
  useEffect(() => {
    const nonce = localStorage.getItem(storageKey);
    if (!nonce || !client) return;
    void client
      .get(nonce)
      .then(setHandoff)
      .catch(() => localStorage.removeItem(storageKey));
  }, [client, storageKey]);

  useEffect(() => {
    if (!handoff || !client) return;
    const poll = () =>
      void client
        .get(handoff.nonce)
        .then(setHandoff)
        .catch((caught: unknown) =>
          setError(caught instanceof Error ? caught.message : String(caught)),
        );
    const interval = window.setInterval(poll, 2_000);
    return () => window.clearInterval(interval);
  }, [client, handoff?.nonce]);

  useEffect(() => {
    if (!handoff || !reader) return;
    const inspect = () =>
      void reader
        .read(handoff.machineId, handoff.payer)
        .then(setAuthorization)
        .catch(() => setAuthorization(undefined));
    inspect();
    const interval = window.setInterval(inspect, 5_000);
    return () => window.clearInterval(interval);
  }, [handoff?.machineId, handoff?.payer, reader]);

  const deviceUrl = handoff
    ? `${window.location.origin}/device/${handoff.machineId}?handoff=${handoff.nonce}&payer=${handoff.payer}`
    : undefined;
  useEffect(() => {
    if (!deviceUrl) return;
    void QRCode.toDataURL(deviceUrl, {
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 320,
      color: { dark: '#06110d', light: '#f4f7ee' },
    }).then(setQrDataUrl);
  }, [deviceUrl]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  async function createHandoff() {
    if (!client) return;
    if (!runtime.account) {
      runtime.openWallet();
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      const created = await client.create(sourceTransactionHash);
      if (created.payer.toLowerCase() !== runtime.account.toLowerCase())
        throw new Error('This rental belongs to a different connected wallet.');
      localStorage.setItem(storageKey, created.nonce);
      setHandoff(created);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally {
      setBusy(false);
    }
  }

  if (!runtime.config)
    return (
      <div className="route-page">
        <DataState
          kind="offline"
          title="Session service is not configured"
          copy={
            runtime.configurationError ?? 'ProofKey runtime is unavailable.'
          }
        />
      </div>
    );

  const qrRemaining = handoff
    ? Math.max(0, Math.ceil((Date.parse(handoff.expiresAt) - now) / 1_000))
    : 0;
  const controller = authorization?.controller;
  const startVerification =
    handoff?.startReceipt && controller
      ? verifyUsageReceipt(handoff.startReceipt, handoff, controller)
      : undefined;
  const endVerification =
    handoff?.endReceipt && controller
      ? verifyUsageReceipt(handoff.endReceipt, handoff, controller)
      : undefined;

  return (
    <div className="route-page session-page">
      <PageHeading
        eyebrow="SECURE DEVICE HANDOFF"
        title="Move access from wallet to machine."
        copy="A one-time QR binds this exact payer, order, and machine. The device still reads Creditcoin itself before it can unlock."
        action={
          <Link className="button secondary" to="/activity">
            My rentals
          </Link>
        }
      />

      {!handoff ? (
        <section className="handoff-intro">
          <div className="handoff-visual">
            <span>
              <Smartphone size={30} />
            </span>
            <i />
            <span>
              <QrCode size={30} />
            </span>
            <i />
            <span>
              <ShieldCheck size={30} />
            </span>
          </div>
          <div>
            <p className="eyebrow">ONE USE · TWO MINUTES</p>
            <h2>Create a device-safe access handoff</h2>
            <p>
              The QR contains a random nonce and public rental identifiers—never
              your wallet key or signature. A second scan is rejected.
            </p>
            <button
              className="button primary"
              type="button"
              disabled={busy}
              onClick={() => void createHandoff()}
            >
              {busy && <LoaderCircle className="spin" size={16} />}
              {runtime.account
                ? 'Generate one-time QR'
                : 'Connect renter wallet'}
            </button>
            {error && (
              <div className="inline-alert" role="alert">
                {error}
              </div>
            )}
          </div>
        </section>
      ) : (
        <div className="session-grid">
          <section className="qr-ticket">
            <div className="qr-ticket-head">
              <div>
                <p className="eyebrow">DEVICE CLAIM TICKET</p>
                <h2>
                  {handoff.claimedAt ? 'Claimed by device' : 'Ready to scan'}
                </h2>
              </div>
              <span
                className={
                  handoff.claimedAt
                    ? 'claimed'
                    : qrRemaining
                      ? 'live'
                      : 'expired'
                }
              >
                {handoff.claimedAt ? (
                  <>
                    <Check size={13} /> CLAIMED
                  </>
                ) : qrRemaining ? (
                  <>
                    <Clock3 size={13} /> {qrRemaining}s
                  </>
                ) : (
                  'EXPIRED'
                )}
              </span>
            </div>
            {qrDataUrl && !handoff.claimedAt ? (
              <img
                className="handoff-qr"
                src={qrDataUrl}
                alt="One-time device handoff QR code"
              />
            ) : (
              <div className="claimed-device-mark">
                <ShieldCheck size={64} />
                <strong>Device owns this nonce</strong>
              </div>
            )}
            <div className="ticket-binding">
              <Binding label="Machine" value={handoff.machineId} />
              <Binding label="Payer" value={handoff.payer} />
              <Binding label="Order" value={handoff.orderId} />
              <Binding label="Nonce" value={handoff.nonce} />
            </div>
            <div className="ticket-actions">
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(deviceUrl!);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1_500);
                }}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}{' '}
                {copied ? 'Copied' : 'Copy device link'}
              </button>
              <a href={deviceUrl} target="_blank" rel="noreferrer">
                Open device tab <ExternalLink size={14} />
              </a>
            </div>
          </section>

          <section className="session-evidence">
            <div className="session-live-head">
              <div>
                <p className="eyebrow">LIVE SESSION EVIDENCE</p>
                <h2>
                  {handoff.endReceipt
                    ? 'Usage stopped and sealed'
                    : handoff.startReceipt
                      ? 'Machine session active'
                      : handoff.claimedAt
                        ? 'Device checking Creditcoin'
                        : 'Awaiting device claim'}
                </h2>
              </div>
              <RefreshCw
                className={!handoff.endReceipt ? 'spin-slow' : ''}
                size={18}
              />
            </div>
            <ol className="session-timeline">
              <TimelineStep
                done
                title="Payment proven"
                copy={compactHash(handoff.sourceTransactionHash, 12, 8)}
              />
              <TimelineStep
                done={Boolean(handoff.claimedAt)}
                title="One-time device claim"
                copy={
                  handoff.claimedAt
                    ? new Date(handoff.claimedAt).toLocaleString()
                    : 'Waiting for scan'
                }
              />
              <TimelineStep
                done={Boolean(handoff.startReceipt)}
                title="Controller-signed start"
                copy={
                  handoff.startReceipt
                    ? new Date(
                        handoff.startReceipt.payload.startedAt,
                      ).toLocaleString()
                    : 'Waiting for unlock'
                }
              />
              <TimelineStep
                done={Boolean(handoff.endReceipt)}
                title="Controller-signed end"
                copy={
                  handoff.endReceipt
                    ? `${handoff.endReceipt.payload.measuredDurationSeconds}s measured`
                    : 'Session not stopped'
                }
              />
            </ol>
            <div className="receipt-stack">
              {handoff.startReceipt && (
                <ReceiptCard
                  label="START RECEIPT"
                  receipt={handoff.startReceipt}
                  verification={startVerification}
                />
              )}
              {handoff.endReceipt && (
                <ReceiptCard
                  label="END RECEIPT"
                  receipt={handoff.endReceipt}
                  verification={endVerification}
                />
              )}
            </div>
            <Link
              className="text-link"
              to={proofPath(handoff.sourceTransactionHash)}
            >
              Inspect the Attestcoin proof <ExternalLink size={13} />
            </Link>
            {error && (
              <div className="inline-alert" role="alert">
                {error}
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function Binding({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <span>{label}</span>
      <code>{compactHash(value, 11, 8)}</code>
    </div>
  );
}

function TimelineStep({
  done,
  title,
  copy,
}: {
  done: boolean;
  title: string;
  copy: string;
}) {
  return (
    <li className={done ? 'done' : ''}>
      <span>{done ? <Check size={12} /> : ''}</span>
      <div>
        <strong>{title}</strong>
        <small>{copy}</small>
      </div>
    </li>
  );
}

function ReceiptCard({
  label,
  receipt,
  verification,
}: {
  label: string;
  receipt: SignedUsageReceipt;
  verification?: { valid: boolean; reason: string };
}) {
  return (
    <article className="signed-receipt">
      <div>
        <span>{label}</span>
        <strong>{receipt.payload.measuredDurationSeconds}s</strong>
      </div>
      <p className={verification?.valid ? 'verified' : 'pending'}>
        <ShieldCheck size={14} />{' '}
        {verification?.reason ?? 'Reading registered controller…'}
      </p>
      <button type="button" onClick={() => downloadReceipt(receipt)}>
        <Download size={13} /> Download signed JSON
      </button>
    </article>
  );
}

function downloadReceipt(receipt: SignedUsageReceipt) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(receipt, null, 2)], { type: 'application/json' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `proofkey-${receipt.payload.kind}-${receipt.payload.sessionId}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}
