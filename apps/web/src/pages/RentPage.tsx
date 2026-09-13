import {
  ArrowLeft,
  ArrowRight,
  Check,
  ExternalLink,
  LoaderCircle,
  ShieldCheck,
  WalletCards,
} from 'lucide-react';
import { formatEther, formatUnits } from 'ethers';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMarketplace, useRuntime } from '../app/AppProviders.js';
import { DataState, MachineArtwork } from '../components/ProductUI.js';
import type { CheckoutSnapshot, MachineOffer } from '../contracts.js';
import {
  formatDuration,
  progressFromJob,
  totalForDuration,
  type RelayJob,
} from '../flow.js';
import { describeError, proofPath, rentalStorageKey } from '../product.js';
import {
  createRentalSession,
  MAX_DURATION_SECONDS,
  parseRentalSession,
  updateRentalSession,
  type RentalSession,
} from '../rental.js';
import { ProofWorkerClient } from '../worker.js';

const presets = [3_600, 14_400, 86_400];
const checkoutSteps = [
  'Duration',
  'Review',
  'Funds',
  'Payment',
  'Proof',
  'Access',
];

export function Component() {
  const { machineId = '' } = useParams();
  const runtime = useRuntime();
  const marketplace = useMarketplace();
  const machine = marketplace.data?.machines.find(
    (item) => item.machineId === machineId.toLowerCase(),
  );
  const storageKey = runtime.config
    ? rentalStorageKey(runtime.config.registryAddress, machineId)
    : `proofkey:unconfigured:${machineId}`;
  const [session, setSession] = useState<RentalSession>(
    () =>
      parseRentalSession(localStorage.getItem(storageKey), machineId) ??
      createRentalSession(machineId),
  );
  const [customDuration, setCustomDuration] = useState(
    String(session.durationSeconds),
  );
  const [snapshot, setSnapshot] = useState<CheckoutSnapshot>();
  const [job, setJob] = useState<RelayJob>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const worker = useMemo(
    () =>
      runtime.config
        ? new ProofWorkerClient(runtime.config.workerUrl)
        : undefined,
    [runtime.config],
  );

  useEffect(() => {
    setSession(
      parseRentalSession(localStorage.getItem(storageKey), machineId) ??
        createRentalSession(machineId),
    );
    setSnapshot(undefined);
    setJob(undefined);
  }, [machineId, storageKey]);

  const commit = (
    update: Partial<Omit<RentalSession, 'version' | 'machineId'>>,
  ) => {
    setSession((current) => {
      const next = updateRentalSession(current, update);
      localStorage.setItem(storageKey, JSON.stringify(next));
      return next;
    });
  };

  if (!runtime.config || !runtime.paymentClient)
    return (
      <div className="route-page">
        <DataState
          kind="error"
          title="Checkout is not configured"
          copy={runtime.configurationError ?? 'Missing network configuration.'}
        />
      </div>
    );
  if (marketplace.isLoading)
    return (
      <div className="route-page">
        <DataState
          kind="loading"
          title="Preparing verified checkout"
          copy="Revalidating machine policy and payment terms across both chains."
        />
      </div>
    );
  if (marketplace.isError)
    return (
      <div className="route-page">
        <DataState
          kind="offline"
          title="Checkout cannot verify the machine"
          copy="ProofKey fails closed when either chain is unavailable."
          action={
            <button
              type="button"
              className="button secondary"
              onClick={() => void marketplace.refetch()}
            >
              Retry
            </button>
          }
        />
      </div>
    );
  if (!machine)
    return (
      <div className="route-page">
        <DataState
          kind="empty"
          title="Machine not found"
          copy="Return to Explore and select a machine from the live registry."
          action={
            <Link className="button secondary" to="/explore">
              Back to Explore
            </Link>
          }
        />
      </div>
    );
  if (machine.status !== 'available' || !machine.offer)
    return (
      <div className="route-page">
        <DataState
          kind="error"
          title="This machine cannot be rented"
          copy="Its metadata, availability, owner, and tariff must be synchronized across Creditcoin and Sepolia."
          action={
            <Link
              className="button secondary"
              to={`/machines/${machine.machineId}`}
            >
              View machine checks
            </Link>
          }
        />
      </div>
    );

  const offer: MachineOffer = {
    beneficiary: machine.offer.beneficiary,
    pricePerSecond: machine.offer.pricePerSecond,
    active: true,
    tokenAddress: machine.tokenAddress,
    tokenDecimals: machine.tokenDecimals,
    tokenSymbol: machine.tokenSymbol,
  };
  const total = totalForDuration(offer.pricePerSecond, session.durationSeconds);
  const progress = job ? progressFromJob(job) : undefined;
  const displayStart = session.startTime
    ? new Date(Number(session.startTime) * 1000)
    : new Date();
  const displayExpiry = session.expiresAt
    ? new Date(Number(session.expiresAt) * 1000)
    : new Date(displayStart.getTime() + session.durationSeconds * 1000);

  async function inspect() {
    setError(undefined);
    if (!runtime.account) {
      runtime.openWallet();
      return;
    }
    if (!runtime.correctNetwork) {
      await runtime.switchToSepolia();
      return;
    }
    setBusy(true);
    try {
      const next = await runtime.paymentClient!.inspectCheckout(
        machineId,
        offer,
        session.durationSeconds,
        runtime.account,
      );
      setSnapshot(next);
      commit({ phase: 'funds', account: runtime.account });
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function getTestTokens() {
    if (!runtime.walletProvider || !runtime.account || !snapshot) return;
    setBusy(true);
    setError(undefined);
    try {
      await runtime.paymentClient!.mintTestTokens(
        offer,
        runtime.account,
        snapshot.amount * 2n,
        runtime.walletProvider,
      );
      const next = await runtime.paymentClient!.inspectCheckout(
        machineId,
        offer,
        session.durationSeconds,
        runtime.account,
      );
      setSnapshot(next);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  async function followRelay(transactionHash: string) {
    if (!worker) throw new Error('The proof relay is not configured.');
    commit({ phase: 'relay' });
    await worker.enqueue(transactionHash);
    const completed = await worker.waitForCompletion(
      transactionHash,
      (next) => {
        setJob(next);
        commit({
          phase: 'relay',
          creditcoinTransactionHash: next.creditcoinTransactionHash,
        });
      },
    );
    setJob(completed);
    commit({
      phase: 'access',
      creditcoinTransactionHash: completed.creditcoinTransactionHash,
      expiresAt: completed.accessExpiresAt ?? session.expiresAt,
    });
  }

  async function payOrResume() {
    setBusy(true);
    setError(undefined);
    try {
      if (!runtime.account) {
        runtime.openWallet();
        return;
      }
      if (!runtime.correctNetwork) {
        await runtime.switchToSepolia();
        return;
      }
      if (!runtime.walletProvider)
        throw new Error(
          'The wallet transport is still loading. Try again in a moment.',
        );
      if (
        session.account &&
        session.account.toLowerCase() !== runtime.account.toLowerCase()
      )
        throw new Error(
          `Reconnect the wallet that started this rental (${session.account}).`,
        );
      if (session.sourceTransactionHash) {
        const recovered = await runtime.paymentClient!.recoverPayment(
          session.sourceTransactionHash,
          machineId,
        );
        commit({
          phase: 'confirming',
          orderId: recovered.orderId,
          startTime: recovered.startTime.toString(),
          expiresAt: recovered.expiresAt.toString(),
        });
        await followRelay(recovered.transactionHash);
        return;
      }
      if (session.approvalTransactionHash)
        await runtime.paymentClient!.waitForApproval(
          session.approvalTransactionHash,
        );
      const payment = await runtime.paymentClient!.payForUsage(
        machineId,
        offer,
        session.durationSeconds,
        (update) => {
          if (update.stage === 'approving')
            commit({
              phase: 'approving',
              account: runtime.account,
              approvalTransactionHash:
                update.approvalTransactionHash ??
                session.approvalTransactionHash,
            });
          if (update.stage === 'paying')
            commit({ phase: 'payment', account: runtime.account });
          if (update.stage === 'confirming')
            commit({
              phase: 'confirming',
              account: runtime.account,
              sourceTransactionHash: update.paymentTransactionHash,
            });
        },
        runtime.walletProvider,
        runtime.account,
      );
      commit({
        phase: 'confirming',
        sourceTransactionHash: payment.transactionHash,
        orderId: payment.orderId,
        startTime: payment.startTime.toString(),
        expiresAt: payment.expiresAt.toString(),
      });
      await followRelay(payment.transactionHash);
    } catch (caught) {
      setError(describeError(caught));
    } finally {
      setBusy(false);
    }
  }

  function applyDuration(value: number) {
    setCustomDuration(String(value));
    setSnapshot(undefined);
    commit({
      durationSeconds: value,
      phase: 'duration',
      approvalTransactionHash: undefined,
    });
  }

  const activeStep = phaseStep(session.phase);
  return (
    <div className="route-page checkout-page">
      <Link className="back-link" to={`/machines/${machine.machineId}`}>
        <ArrowLeft size={15} /> Machine details
      </Link>
      <ol className="checkout-steps" aria-label="Checkout progress">
        {checkoutSteps.map((label, index) => (
          <li
            key={label}
            className={
              index < activeStep
                ? 'complete'
                : index === activeStep
                  ? 'active'
                  : ''
            }
          >
            <span>{index < activeStep ? <Check size={12} /> : index + 1}</span>
            <strong>{label}</strong>
          </li>
        ))}
      </ol>

      <div className="checkout-grid">
        <section className="checkout-summary">
          <MachineArtwork compact />
          <p className="eyebrow">VERIFIED RENTAL</p>
          <h1>{machine.metadata?.name}</h1>
          <p>
            {machine.metadata?.location.city},{' '}
            {machine.metadata?.location.country}
          </p>
          <div className="summary-trust">
            <ShieldCheck size={17} />
            <span>
              Owner, controller, tariff, metadata, and availability match across
              both chains.
            </span>
          </div>
          <div className="rental-window">
            <div>
              <span>Starts</span>
              <strong>{displayStart.toLocaleString()}</strong>
            </div>
            <div>
              <span>Access expires</span>
              <strong>{displayExpiry.toLocaleString()}</strong>
            </div>
          </div>
        </section>

        <section className="checkout-card">
          <div className="checkout-title">
            <div>
              <p className="eyebrow">CHECKOUT / SEPOLIA TESTNET</p>
              <h2>{checkoutTitle(session.phase)}</h2>
            </div>
            <span>{String(activeStep + 1).padStart(2, '0')}—06</span>
          </div>

          {session.phase === 'duration' && (
            <>
              <div
                className="duration-picker"
                role="radiogroup"
                aria-label="Rental duration"
              >
                {presets.map((value) => (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={session.durationSeconds === value}
                    className={
                      session.durationSeconds === value ? 'selected' : ''
                    }
                    disabled={busy}
                    onClick={() => applyDuration(value)}
                  >
                    <strong>{value / 3_600}</strong>
                    <span>{value === 3_600 ? 'HOUR' : 'HOURS'}</span>
                  </button>
                ))}
              </div>
              <label className="custom-duration">
                <span>Exact custom duration</span>
                <div>
                  <input
                    aria-label="Custom duration in seconds"
                    inputMode="numeric"
                    type="number"
                    min="1"
                    max={MAX_DURATION_SECONDS}
                    value={customDuration}
                    onChange={(event) => setCustomDuration(event.target.value)}
                  />
                  <small>SECONDS · MAX 2,592,000</small>
                </div>
              </label>
            </>
          )}

          <div className="price-lines">
            <div>
              <span>Machine time</span>
              <strong>{formatDuration(session.durationSeconds)}</strong>
            </div>
            <div>
              <span>Live tariff</span>
              <strong>
                {formatUnits(offer.pricePerSecond, offer.tokenDecimals)}{' '}
                {offer.tokenSymbol} / sec
              </strong>
            </div>
            <div>
              <span>Beneficiary</span>
              <strong className="mono-value">{offer.beneficiary}</strong>
            </div>
            <div className="total">
              <span>Total due</span>
              <strong>
                {formatUnits(total, offer.tokenDecimals)} {offer.tokenSymbol}
              </strong>
            </div>
          </div>

          {session.phase === 'funds' && snapshot && (
            <div className="funds-panel">
              <CheckRow
                ok={snapshot.balanceSufficient}
                label={`${offer.tokenSymbol} balance`}
                value={`${formatUnits(snapshot.tokenBalance, offer.tokenDecimals)} ${offer.tokenSymbol}`}
              />
              <CheckRow
                ok={snapshot.gasSufficient}
                label="Sepolia gas"
                value={`${formatEther(snapshot.nativeBalance)} ETH`}
              />
              {!snapshot.gasSufficient && snapshot.nativeBalance > 0n && (
                <small className="gas-note">
                  Estimated gas reserve: {formatEther(snapshot.gasRequired)} ETH
                </small>
              )}
              <CheckRow
                ok={!snapshot.needsApproval}
                label="Token allowance"
                value={
                  snapshot.needsApproval
                    ? 'Exact approval needed'
                    : 'Already sufficient'
                }
              />
              {!snapshot.balanceSufficient && snapshot.faucetSupported && (
                <button
                  className="test-token-button"
                  type="button"
                  disabled={busy}
                  onClick={() => void getTestTokens()}
                >
                  <WalletCards size={16} /> Get test {offer.tokenSymbol}{' '}
                  <small>TESTNET ONLY</small>
                </button>
              )}
              {!snapshot.gasSufficient && (
                <a
                  className="text-link"
                  href="https://cloud.google.com/application/web3/faucet/ethereum/sepolia"
                  target="_blank"
                  rel="noreferrer"
                >
                  Open Sepolia ETH faucet <ExternalLink size={13} />
                </a>
              )}
            </div>
          )}

          {session.phase === 'duration' ? (
            <button
              className="checkout-action"
              type="button"
              onClick={() => {
                const value = Number(customDuration);
                if (
                  !Number.isSafeInteger(value) ||
                  value < 1 ||
                  value > MAX_DURATION_SECONDS
                ) {
                  setError(
                    'Enter a whole-number duration from 1 second to 30 days.',
                  );
                  return;
                }
                commit({ durationSeconds: value, phase: 'review' });
                setError(undefined);
              }}
            >
              <span>Review exact rental</span>
              <ArrowRight size={19} />
            </button>
          ) : session.phase === 'review' ? (
            <div className="checkout-action-stack">
              <button
                className="button secondary"
                type="button"
                onClick={() => commit({ phase: 'duration' })}
              >
                Edit duration
              </button>
              <button
                className="checkout-action"
                type="button"
                disabled={busy}
                onClick={() => void inspect()}
              >
                <span>
                  {busy && <LoaderCircle className="spin" size={18} />}
                  {!runtime.account
                    ? 'Connect wallet'
                    : !runtime.correctNetwork
                      ? 'Switch to Sepolia'
                      : 'Check balance & allowance'}
                </span>
                <ArrowRight size={19} />
              </button>
            </div>
          ) : session.phase === 'funds' ? (
            <button
              className="checkout-action"
              type="button"
              disabled={
                busy || !snapshot?.balanceSufficient || !snapshot.gasSufficient
              }
              onClick={() => commit({ phase: 'payment' })}
            >
              <span>Continue to secure payment</span>
              <ArrowRight size={19} />
            </button>
          ) : session.phase === 'access' ? (
            <button
              className="checkout-action success"
              type="button"
              onClick={() => {
                localStorage.removeItem(storageKey);
                setSession(createRentalSession(machineId));
                setSnapshot(undefined);
                setJob(undefined);
              }}
            >
              <span>Access unlocked · Start another rental</span>
              <Check size={19} />
            </button>
          ) : (
            <button
              className="checkout-action"
              type="button"
              disabled={busy}
              onClick={() => void payOrResume()}
            >
              <span>
                {busy && <LoaderCircle className="spin" size={18} />}
                {paymentLabel(session.phase)}
              </span>
              <ArrowRight size={19} />
            </button>
          )}

          <p className="checkout-help">
            Approval is exact—not unlimited. A stored payment is always
            recovered before the relay runs, preventing duplicate charges.
          </p>
          {error && (
            <div className="inline-alert" role="alert">
              <strong>Checkout paused safely</strong>
              <span>{error}</span>
            </div>
          )}
          <TransactionLinks session={session} config={runtime.config} />
        </section>
      </div>

      <section className="proof-journey">
        <div className="section-heading">
          <div>
            <p className="eyebrow">LIVE PROOF JOURNEY</p>
            <h2>
              {progress?.label ??
                (session.sourceTransactionHash
                  ? 'Payment stored · ready to resume'
                  : 'Begins after payment')}
            </h2>
          </div>
          {session.sourceTransactionHash && (
            <Link
              className="text-link light"
              to={proofPath(session.sourceTransactionHash)}
            >
              Open proof details <ExternalLink size={14} />
            </Link>
          )}
        </div>
        <ol className="journey-steps">
          {['payment', 'confirmation', 'proof', 'unlock'].map((key, index) => {
            const completed =
              progress?.completed.includes(key as never) ??
              Boolean(session.sourceTransactionHash && index === 0);
            const active = progress?.active === key;
            return (
              <li
                key={key}
                className={completed ? 'complete' : active ? 'active' : ''}
              >
                <span>{completed ? <Check size={14} /> : index + 1}</span>
                <div>
                  <strong>
                    {
                      [
                        'Sepolia payment',
                        'Receipt confirmation',
                        'Attestcoin proof',
                        'Creditcoin access',
                      ][index]
                    }
                  </strong>
                  <small>
                    {
                      [
                        'Owner paid directly',
                        'Canonical source block',
                        'Merkle + continuity',
                        'Expiring AccessPass',
                      ][index]
                    }
                  </small>
                </div>
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}

function CheckRow({
  ok,
  label,
  value,
}: {
  ok: boolean;
  label: string;
  value: string;
}) {
  return (
    <div className="fund-check">
      <span className={ok ? 'check ok' : 'check'}>
        {ok && <Check size={12} />}
      </span>
      <div>
        <strong>{label}</strong>
        <small>{value}</small>
      </div>
    </div>
  );
}

function TransactionLinks({
  session,
  config,
}: {
  session: RentalSession;
  config: NonNullable<ReturnType<typeof useRuntime>['config']>;
}) {
  if (
    !session.approvalTransactionHash &&
    !session.sourceTransactionHash &&
    !session.creditcoinTransactionHash
  )
    return null;
  return (
    <div className="checkout-transactions">
      {session.approvalTransactionHash && (
        <a
          href={`${config.sepoliaExplorerUrl}/tx/${session.approvalTransactionHash}`}
          target="_blank"
          rel="noreferrer"
        >
          Approval transaction <ExternalLink size={12} />
        </a>
      )}
      {session.sourceTransactionHash && (
        <a
          href={`${config.sepoliaExplorerUrl}/tx/${session.sourceTransactionHash}`}
          target="_blank"
          rel="noreferrer"
        >
          Payment transaction <ExternalLink size={12} />
        </a>
      )}
      {session.creditcoinTransactionHash && (
        <a
          href={`${config.creditcoinExplorerUrl}/tx/${session.creditcoinTransactionHash}`}
          target="_blank"
          rel="noreferrer"
        >
          Creditcoin execution <ExternalLink size={12} />
        </a>
      )}
    </div>
  );
}

function phaseStep(phase: RentalSession['phase']) {
  return {
    duration: 0,
    review: 1,
    funds: 2,
    payment: 3,
    approving: 3,
    confirming: 3,
    relay: 4,
    access: 5,
  }[phase];
}
function checkoutTitle(phase: RentalSession['phase']) {
  return {
    duration: 'Choose operating time',
    review: 'Review exact terms',
    funds: 'Verify wallet readiness',
    payment: 'Authorize payment',
    approving: 'Approve exact tokens',
    confirming: 'Confirming payment',
    relay: 'Building access proof',
    access: 'Machine access ready',
  }[phase];
}
function paymentLabel(phase: RentalSession['phase']) {
  if (phase === 'approving') return 'Resume exact token approval';
  if (phase === 'confirming') return 'Resume confirmed payment';
  if (phase === 'relay') return 'Resume Attestcoin proof';
  return 'Approve if needed & pay';
}
