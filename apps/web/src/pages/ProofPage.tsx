import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Blocks,
  Check,
  CircleAlert,
  Clock3,
  Download,
  ExternalLink,
  FileJson,
  Fingerprint,
  Link2,
  Network,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useRuntime } from '../app/AppProviders.js';
import { DataState, PageHeading } from '../components/ProductUI.js';
import { progressFromJob, type RelayPhase } from '../flow.js';
import {
  ProofExplorerClient,
  downloadPublicEvidence,
  type ProofInvariant,
  type ProofRecord,
} from '../proof.js';
import { compactHash, isTransactionHash, machinePath } from '../product.js';
import { ProofLookupError } from '../worker.js';

const phases: Array<{ key: RelayPhase; label: string }> = [
  { key: 'source_confirmation', label: 'Source receipt' },
  { key: 'attestation_wait', label: 'Block coverage' },
  { key: 'proof_generation', label: 'Proof built' },
  { key: 'creditcoin_execution', label: 'CC3 execution' },
  { key: 'completed', label: 'Access result' },
];

export function Component() {
  const { sourceTxHash: identifier = 'search' } = useParams();
  const navigate = useNavigate();
  const { config } = useRuntime();
  const [search, setSearch] = useState(
    identifier === 'search' ? '' : identifier,
  );
  const validIdentifier = isTransactionHash(identifier);
  const record = useQuery({
    queryKey: ['public-proof', identifier],
    queryFn: () => new ProofExplorerClient(config!).load(identifier),
    enabled: Boolean(config && validIdentifier),
    retry: (count, error) =>
      !(error instanceof ProofLookupError && error.status === 404) && count < 2,
    refetchInterval: (query) => {
      const phase = query.state.data?.evidence.relay.phase;
      return phase && !['completed', 'duplicate', 'failed'].includes(phase)
        ? 5_000
        : false;
    },
  });

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const value = search.trim();
    if (isTransactionHash(value)) navigate(`/proofs/${value}`);
  }

  return (
    <div className="route-page proof-page">
      <PageHeading
        eyebrow="PUBLIC ATTESTCOIN PROOF EXPLORER"
        title="Trace access across both chains."
        copy="Search by Sepolia transaction, order ID, Attestcoin query ID, or Creditcoin transaction. Every verdict is recomputed from public evidence."
      />
      <form className="proof-search" onSubmit={submit}>
        <Search size={20} />
        <input
          aria-label="Proof identifier"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Paste a transaction hash, order ID, or query ID"
          spellCheck={false}
        />
        <button type="submit" disabled={!isTransactionHash(search.trim())}>
          Inspect proof <ArrowRight size={16} />
        </button>
      </form>
      <div className="proof-search-scopes" aria-label="Searchable identifiers">
        <span>Source transaction</span>
        <span>Order ID</span>
        <span>Query ID</span>
        <span>CC3 transaction</span>
      </div>

      {identifier === 'search' ? (
        <ProofIntroduction />
      ) : !validIdentifier ? (
        <DataState
          kind="error"
          title="That identifier is not valid"
          copy="Provide a 32-byte 0x-prefixed transaction hash, order ID, or query ID."
        />
      ) : record.isLoading ? (
        <DataState
          kind="loading"
          title="Recomputing public proof evidence"
          copy="Reading the relay index, both chains, machine policy, and access state."
        />
      ) : record.isError ? (
        <ProofError error={record.error} identifier={identifier} />
      ) : record.data ? (
        <ProofDetails record={record.data} />
      ) : null}
    </div>
  );
}

function ProofIntroduction() {
  return (
    <>
      <section className="proof-intro-grid">
        <article>
          <span>01</span>
          <Blocks />
          <h2>Read the source</h2>
          <p>
            Decode the confirmed UsagePaid receipt and identify the payer,
            machine, duration, beneficiary, and amount.
          </p>
        </article>
        <article>
          <span>02</span>
          <Network />
          <h2>Inspect Attestcoin</h2>
          <p>
            Examine covered height, Merkle path, continuity endpoint, and the
            native query carried into Creditcoin.
          </p>
        </article>
        <article>
          <span>03</span>
          <ShieldCheck />
          <h2>Recompute policy</h2>
          <p>
            Compare proven values with the live Creditcoin owner, tariff, replay
            guard, and AccessPass expiry.
          </p>
        </article>
      </section>
      <section className="proof-empty-callout">
        <Fingerprint />
        <div>
          <strong>No wallet connection required</strong>
          <p>
            Verification is public and read-only. Share this URL with an
            auditor, machine operator, or renter.
          </p>
        </div>
      </section>
    </>
  );
}

function ProofError({
  error,
  identifier,
}: {
  error: Error;
  identifier: string;
}) {
  const unknown = error instanceof ProofLookupError && error.status === 404;
  return (
    <DataState
      kind={unknown ? 'empty' : 'offline'}
      title={
        unknown ? 'No indexed proof found' : 'Proof services are unavailable'
      }
      copy={
        unknown
          ? 'No relay record matches this source transaction, order ID, query ID, or Creditcoin transaction.'
          : 'The explorer could not safely combine relay and on-chain data. No verification result was inferred.'
      }
      action={
        <a
          className="button secondary"
          href={`https://sepolia.etherscan.io/tx/${identifier}`}
          target="_blank"
          rel="noreferrer"
        >
          Check Sepolia directly <ExternalLink size={14} />
        </a>
      }
    />
  );
}

function ProofDetails({ record }: { record: ProofRecord }) {
  const { evidence, chain, invariants } = record;
  const progress = progressFromJob({
    sourceTransactionHash: evidence.source.transactionHash,
    phase: evidence.relay.phase,
    failedAtPhase: evidence.relay.failedAtPhase,
    error: evidence.relay.failure?.message,
  });
  const passed = invariants.filter((item) => item.status === 'pass').length;
  const failed = invariants.filter((item) => item.status === 'fail').length;
  const phaseClass = stateClass(evidence.relay.phase, failed);

  return (
    <section className="proof-record">
      <div className="proof-record-head">
        <div>
          <span className={`proof-verdict ${phaseClass}`}>
            {phaseIcon(evidence.relay.phase, failed)}
            {stateLabel(evidence.relay.phase, failed)}
          </span>
          <h2>{progress.label}</h2>
          <code>{evidence.source.transactionHash}</code>
        </div>
        <div className="proof-score">
          <strong>
            {passed}/{invariants.length}
          </strong>
          <span>
            {failed ? `${failed} failed checks` : 'computed checks pass'}
          </span>
        </div>
      </div>

      <ProofTimeline
        phase={evidence.relay.phase}
        failedAtPhase={evidence.relay.failedAtPhase}
      />

      <div className="proof-chain-grid">
        <ChainCard
          eyebrow="ETHEREUM SEPOLIA"
          title="UsagePaid receipt"
          value={compactHash(evidence.source.transactionHash, 12, 10)}
          meta={`Block ${evidence.source.blockNumber ?? 'pending'} · status ${chain.receiptStatus ?? 'pending'}`}
          externalHref={`https://sepolia.etherscan.io/tx/${evidence.source.transactionHash}`}
        />
        <ChainCard
          eyebrow="ATTESTCOIN"
          title="Native query proof"
          value={
            evidence.creditcoin.queryId
              ? compactHash(evidence.creditcoin.queryId, 12, 10)
              : 'Query pending'
          }
          meta={
            evidence.attestcoin
              ? `Chain ${evidence.attestcoin.chainKey} · covered ${evidence.attestcoin.blockHeight}`
              : 'Proof material is not available yet'
          }
        />
        <ChainCard
          eyebrow="CREDITCOIN CC3"
          title="Policy execution"
          value={
            evidence.creditcoin.transactionHash
              ? compactHash(evidence.creditcoin.transactionHash, 12, 10)
              : 'Execution pending'
          }
          meta={`Replay guard ${chain.orderProcessed === undefined ? 'pending' : chain.orderProcessed ? 'set' : 'open'}`}
          externalHref={
            evidence.creditcoin.transactionHash
              ? `https://creditcoin-testnet.blockscout.com/tx/${evidence.creditcoin.transactionHash}`
              : undefined
          }
        />
      </div>

      <div className="proof-section-heading">
        <div>
          <span>POLICY VERDICT</span>
          <h2>Expected vs. proven</h2>
        </div>
        <p>
          These rows are computed from the Sepolia receipt, Attestcoin proof,
          and current Creditcoin contract state.
        </p>
      </div>
      <div
        className="invariant-table"
        role="table"
        aria-label="Proof invariants"
      >
        <div className="invariant-row invariant-header" role="row">
          <span>Invariant</span>
          <span>Expected</span>
          <span>Actual</span>
          <span>Result</span>
        </div>
        {invariants.map((item) => (
          <InvariantRow key={item.key} invariant={item} />
        ))}
      </div>

      <div className="proof-evidence-grid">
        <article className="proof-evidence-card">
          <div className="proof-section-heading compact-heading">
            <div>
              <span>DECODED USAGEPAID</span>
              <h2>Source values</h2>
            </div>
          </div>
          <dl className="proof-detail-list">
            <Detail label="Order ID" value={evidence.source.payment?.orderId} />
            <Detail
              label="Machine ID"
              value={evidence.source.payment?.machineId}
            />
            <Detail label="Payer" value={evidence.source.payment?.payer} />
            <Detail
              label="Beneficiary"
              value={evidence.source.payment?.beneficiary}
            />
            <Detail
              label="Duration"
              value={
                evidence.source.payment
                  ? `${evidence.source.payment.duration} seconds`
                  : undefined
              }
            />
            <Detail label="Amount" value={evidence.source.payment?.amount} />
          </dl>
          {evidence.source.payment?.machineId && (
            <Link
              className="text-link"
              to={machinePath(evidence.source.payment.machineId)}
            >
              Open machine profile <ArrowRight size={14} />
            </Link>
          )}
        </article>
        <article className="proof-evidence-card">
          <div className="proof-section-heading compact-heading">
            <div>
              <span>ATTESTCOIN MATERIAL</span>
              <h2>Continuity path</h2>
            </div>
          </div>
          <dl className="proof-detail-list">
            <Detail
              label="Merkle root"
              value={evidence.attestcoin?.merkleRoot}
            />
            <Detail
              label="Lower endpoint"
              value={evidence.attestcoin?.lowerEndpointDigest}
            />
            <Detail
              label="Merkle siblings"
              value={
                evidence.attestcoin
                  ? String(evidence.attestcoin.siblings.length)
                  : undefined
              }
            />
            <Detail
              label="Continuity roots"
              value={
                evidence.attestcoin
                  ? String(evidence.attestcoin.continuityRoots.length)
                  : undefined
              }
            />
            <Detail label="Query ID" value={evidence.creditcoin.queryId} />
            <Detail
              label="Access expiry"
              value={formatTimestamp(
                chain.accessExpiresAt ?? evidence.creditcoin.accessExpiresAt,
              )}
            />
          </dl>
        </article>
      </div>

      {evidence.relay.failure && (
        <div className="proof-failure" role="alert">
          <CircleAlert />
          <div>
            <strong>{evidence.relay.failure.code}</strong>
            <p>{evidence.relay.failure.message}</p>
            <small>
              Stopped at {evidence.relay.failure.phase.replaceAll('_', ' ')}
            </small>
          </div>
        </div>
      )}

      <section className="trust-boundary">
        <div className="proof-section-heading">
          <div>
            <span>HOW TO READ THIS</span>
            <h2>Finality and trust boundary</h2>
          </div>
        </div>
        <div>
          <article>
            <Clock3 />
            <strong>Finality</strong>
            <p>
              Proof building begins only after the configured Sepolia
              confirmations and Attestcoin block coverage.
            </p>
          </article>
          <article>
            <Fingerprint />
            <strong>Replay protection</strong>
            <p>
              ProofKeyASC consumes both query ID and order ID once. A second
              execution reverts without granting access.
            </p>
          </article>
          <article>
            <Link2 />
            <strong>Trust boundary</strong>
            <p>
              The relay transports proof bytes; it cannot grant access.
              Creditcoin’s verifier and ProofKeyASC enforce the result.
            </p>
          </article>
        </div>
      </section>

      <div className="proof-export-bar">
        <div>
          <FileJson />
          <span>
            <strong>Public evidence bundle</strong>
            <small>
              Proof bytes and public chain facts only—no RPC URLs, keys, or
              internal paths.
            </small>
          </span>
        </div>
        <button type="button" onClick={() => downloadPublicEvidence(evidence)}>
          <Download size={16} /> Download JSON
        </button>
      </div>
    </section>
  );
}

function ProofTimeline({
  phase,
  failedAtPhase,
}: {
  phase: RelayPhase;
  failedAtPhase?: RelayPhase;
}) {
  const current = phaseIndex(phase === 'failed' ? failedAtPhase : phase);
  return (
    <div className="proof-timeline" aria-label="Proof lifecycle">
      {phases.map((item, index) => (
        <div
          key={item.key}
          className={
            phase === 'failed' && index === current
              ? 'failed'
              : index < current || ['completed', 'duplicate'].includes(phase)
                ? 'complete'
                : index === current
                  ? 'current'
                  : ''
          }
        >
          <span>
            {index < current || ['completed', 'duplicate'].includes(phase) ? (
              <Check size={13} />
            ) : (
              index + 1
            )}
          </span>
          <small>{item.label}</small>
        </div>
      ))}
    </div>
  );
}

function ChainCard({
  eyebrow,
  title,
  value,
  meta,
  externalHref,
}: {
  eyebrow: string;
  title: string;
  value: string;
  meta: string;
  externalHref?: string;
}) {
  return (
    <article>
      <span>{eyebrow}</span>
      <h3>{title}</h3>
      <code>{value}</code>
      <small>{meta}</small>
      {externalHref && (
        <a
          href={externalHref}
          target="_blank"
          rel="noreferrer"
          aria-label={`Open ${title} in explorer`}
        >
          Explorer <ExternalLink size={12} />
        </a>
      )}
    </article>
  );
}

function InvariantRow({ invariant }: { invariant: ProofInvariant }) {
  return (
    <div className={`invariant-row ${invariant.status}`} role="row">
      <span>
        <i>
          {invariant.status === 'pass' ? (
            <Check size={13} />
          ) : invariant.status === 'fail' ? (
            <X size={13} />
          ) : (
            <Clock3 size={13} />
          )}
        </i>
        <span>
          <strong>{invariant.label}</strong>
          <small>{invariant.explanation}</small>
        </span>
      </span>
      <code title={invariant.expected}>
        {compactHash(invariant.expected, 18, 12)}
      </code>
      <code title={invariant.actual}>
        {compactHash(invariant.actual, 18, 12)}
      </code>
      <b>{invariant.status}</b>
    </div>
  );
}

function Detail({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd title={value}>{value ? compactHash(value, 18, 12) : 'Pending'}</dd>
    </div>
  );
}

function phaseIndex(phase?: RelayPhase) {
  if (phase === 'queued') return 0;
  if (phase === 'duplicate') return phases.length;
  if (!phase || phase === 'failed') return 0;
  return Math.max(
    0,
    phases.findIndex((item) => item.key === phase),
  );
}

function stateClass(phase: RelayPhase, failedInvariants: number) {
  if (phase === 'failed' || failedInvariants) return 'failed';
  if (phase === 'completed') return 'verified';
  if (phase === 'duplicate') return 'duplicate';
  return 'pending';
}

function stateLabel(phase: RelayPhase, failedInvariants: number) {
  if (failedInvariants) return 'Invariant mismatch';
  return {
    queued: 'Queued',
    source_confirmation: 'Confirming source',
    attestation_wait: 'Awaiting block coverage',
    proof_generation: 'Building proof',
    creditcoin_execution: 'Executing on CC3',
    completed: 'Verified access proof',
    duplicate: 'Verified duplicate',
    failed: 'Proof failed',
  }[phase];
}

function phaseIcon(phase: RelayPhase, failedInvariants: number) {
  if (phase === 'failed' || failedInvariants) return <X size={14} />;
  if (phase === 'completed' || phase === 'duplicate')
    return <Check size={14} />;
  return <Clock3 size={14} />;
}

function formatTimestamp(value?: string) {
  if (!value) return undefined;
  const milliseconds = Number(value) * 1_000;
  return Number.isFinite(milliseconds)
    ? new Intl.DateTimeFormat('en', {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(milliseconds)
    : value;
}
