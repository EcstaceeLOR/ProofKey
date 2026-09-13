import {
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-react';
import { formatUnits } from 'ethers';
import { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMachineOffer, useRuntime } from '../app/AppProviders.js';
import { DataState, MachineArtwork } from '../components/ProductUI.js';
import {
  formatDuration,
  progressFromJob,
  totalForDuration,
  type RelayJob,
} from '../flow.js';
import { describeError, proofPath, rentalStorageKey } from '../product.js';
import { ProofWorkerClient } from '../worker.js';

const durations = [3_600, 14_400, 86_400];
const steps = [
  ['payment', 'Pay on Sepolia'],
  ['confirmation', 'Confirm receipt'],
  ['proof', 'Build Attestcoin proof'],
  ['unlock', 'Unlock on Creditcoin'],
] as const;

export function Component() {
  const { machineId = '' } = useParams();
  const runtime = useRuntime();
  const offerQuery = useMachineOffer();
  const [duration, setDuration] = useState(14_400);
  const storageKey = runtime.config
    ? rentalStorageKey(runtime.config.registryAddress, runtime.config.machineId)
    : 'proofkey:unconfigured';
  const [sourceTransactionHash, setSourceTransactionHash] = useState<
    string | undefined
  >(() => localStorage.getItem(storageKey) ?? undefined);
  const [expiresAt, setExpiresAt] = useState<bigint>();
  const [job, setJob] = useState<RelayJob>();
  const [busy, setBusy] = useState(false);
  const [paymentStage, setPaymentStage] = useState<string>();
  const [error, setError] = useState<string>();
  const worker = useMemo(
    () =>
      runtime.config
        ? new ProofWorkerClient(runtime.config.workerUrl)
        : undefined,
    [runtime.config],
  );

  if (!runtime.config || !runtime.paymentClient) {
    return (
      <div className="route-page">
        <DataState
          kind="error"
          title="Checkout is not configured"
          copy={runtime.configurationError ?? 'Missing network configuration.'}
        />
      </div>
    );
  }
  if (machineId.toLowerCase() !== runtime.config.machineId.toLowerCase()) {
    return (
      <div className="route-page">
        <DataState
          kind="empty"
          title="Machine not found"
          copy="Return to Explore and select a machine from the live registry."
        />
      </div>
    );
  }

  const offer = offerQuery.data;
  const progress = job ? progressFromJob(job) : undefined;
  const verified = progress?.verified ?? false;
  const total = offer
    ? totalForDuration(offer.pricePerSecond, duration)
    : undefined;

  async function followRelay(transactionHash: string) {
    if (!worker) throw new Error('The proof relay is not configured.');
    await worker.enqueue(transactionHash);
    const completed = await worker.waitForCompletion(transactionHash, setJob);
    setJob(completed);
    if (completed.accessExpiresAt)
      setExpiresAt(BigInt(completed.accessExpiresAt));
    localStorage.removeItem(storageKey);
  }

  async function act() {
    setError(undefined);
    setBusy(true);
    try {
      if (!runtime.account) {
        runtime.openWallet();
        return;
      }
      if (!runtime.correctNetwork) {
        await runtime.switchToSepolia();
        return;
      }
      if (!offer || !worker) return;
      if (!runtime.walletProvider)
        throw new Error(
          'The connected wallet transport is still loading. Try again in a moment.',
        );
      if (sourceTransactionHash)
        return await followRelay(sourceTransactionHash);
      const payment = await runtime.paymentClient!.payForUsage(
        offer,
        duration,
        (update) => {
          setPaymentStage(update.stage);
          if (update.transactionHash) {
            setSourceTransactionHash(update.transactionHash);
            localStorage.setItem(storageKey, update.transactionHash);
          }
        },
        runtime.walletProvider,
        runtime.account,
      );
      setSourceTransactionHash(payment.transactionHash);
      setExpiresAt(payment.expiresAt);
      localStorage.setItem(storageKey, payment.transactionHash);
      await followRelay(payment.transactionHash);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  function actionLabel() {
    if (verified) return 'Machine access unlocked';
    if (busy) {
      if (paymentStage === 'approving') return 'Confirm token approval';
      if (paymentStage === 'paying') return 'Confirm usage payment';
      return progress?.label ?? 'Preparing transaction…';
    }
    if (!runtime.account) return 'Connect wallet to continue';
    if (!runtime.correctNetwork) return 'Switch to Ethereum Sepolia';
    if (sourceTransactionHash) return 'Resume proof verification';
    return 'Pay & start verification';
  }

  return (
    <div className="route-page checkout-page">
      <Link className="back-link" to={`/machines/${runtime.config.machineId}`}>
        <ArrowLeft size={15} /> Machine details
      </Link>
      <div className="checkout-grid">
        <section className="checkout-summary">
          <MachineArtwork compact />
          <p className="eyebrow">YOUR RENTAL</p>
          <h1>{runtime.config.machineName}</h1>
          <p>{runtime.config.machineLocation}</p>
          <div className="summary-trust">
            <ShieldCheck size={17} />
            <span>
              Owner, tariff, and availability checked across both chains.
            </span>
          </div>
        </section>

        <section className="checkout-card">
          <div className="checkout-title">
            <div>
              <p className="eyebrow">CHECKOUT / TESTNET</p>
              <h2>Choose operating time</h2>
            </div>
            <span>01—04</span>
          </div>
          <div
            className="duration-picker"
            role="radiogroup"
            aria-label="Rental duration"
          >
            {durations.map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={duration === value}
                className={duration === value ? 'selected' : ''}
                disabled={busy || verified}
                onClick={() => setDuration(value)}
              >
                <strong>{value / 3_600}</strong>
                <span>{value === 3_600 ? 'HOUR' : 'HOURS'}</span>
              </button>
            ))}
          </div>
          <div className="price-lines">
            <div>
              <span>Machine time</span>
              <strong>{formatDuration(duration)}</strong>
            </div>
            <div>
              <span>Cross-chain verification</span>
              <strong className="included">INCLUDED</strong>
            </div>
            <div className="total">
              <span>Total due</span>
              <strong>
                {total !== undefined && offer
                  ? `${formatUnits(total, offer.tokenDecimals)} ${offer.tokenSymbol}`
                  : '—'}
              </strong>
            </div>
          </div>
          <button
            className="checkout-action"
            type="button"
            onClick={() => void act()}
            disabled={
              verified || !offer || !offer.active || offerQuery.isLoading
            }
          >
            <span>
              {busy && <LoaderCircle className="spin" size={18} />}
              {actionLabel()}
            </span>
            {verified ? <Check size={19} /> : <ArrowRight size={19} />}
          </button>
          <p className="checkout-help">
            {busy
              ? 'Keep this page open. Attestcoin coverage can take several minutes.'
              : 'You approve only the exact token amount, then confirm one payment.'}
          </p>
          {error && (
            <div className="inline-alert" role="alert">
              <strong>Transaction paused</strong>
              <span>{error}</span>
            </div>
          )}
        </section>
      </div>

      <section className="proof-journey">
        <div className="section-heading">
          <div>
            <p className="eyebrow">LIVE PROOF JOURNEY</p>
            <h2>{progress?.label ?? 'Ready when you are'}</h2>
          </div>
          {sourceTransactionHash && (
            <Link
              className="text-link light"
              to={proofPath(sourceTransactionHash)}
            >
              Open proof details <ExternalLink size={14} />
            </Link>
          )}
        </div>
        <ol className="journey-steps">
          {steps.map(([key, label], index) => {
            const completed = progress?.completed.includes(key) ?? false;
            const active = progress?.active === key;
            return (
              <li
                key={key}
                className={completed ? 'complete' : active ? 'active' : ''}
              >
                <span>{completed ? <Check size={14} /> : index + 1}</span>
                <div>
                  <strong>{label}</strong>
                  <small>
                    {key === 'payment'
                      ? 'Funds go to the owner'
                      : key === 'proof'
                        ? 'Inclusion + continuity'
                        : key === 'unlock'
                          ? 'Expiring AccessPass'
                          : 'Canonical source block'}
                  </small>
                </div>
              </li>
            );
          })}
        </ol>
        {sourceTransactionHash && (
          <div className="journey-receipt">
            <div>
              <span>Source transaction</span>
              <a
                href={`${runtime.config.sepoliaExplorerUrl}/tx/${sourceTransactionHash}`}
                target="_blank"
                rel="noreferrer"
              >
                {sourceTransactionHash}
                <ExternalLink size={13} />
              </a>
            </div>
            <div>
              <span>Access expires</span>
              <strong>
                {expiresAt
                  ? new Date(Number(expiresAt) * 1_000).toLocaleString()
                  : 'Calculated from proven receipt'}
              </strong>
            </div>
            <div>
              <span>Final state</span>
              <strong>
                {verified ? 'Verified on Creditcoin' : 'Proof in progress'}
              </strong>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
