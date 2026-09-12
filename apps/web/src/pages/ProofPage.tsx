import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Check,
  ExternalLink,
  Search,
  ShieldCheck,
} from 'lucide-react';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useRuntime } from '../app/AppProviders.js';
import { DataState, PageHeading } from '../components/ProductUI.js';
import { progressFromJob } from '../flow.js';
import { compactHash, isTransactionHash, proofPath } from '../product.js';
import { ProofWorkerClient } from '../worker.js';

export function Component() {
  const { sourceTxHash = 'search' } = useParams();
  const navigate = useNavigate();
  const { config } = useRuntime();
  const [search, setSearch] = useState(
    sourceTxHash === 'search' ? '' : sourceTxHash,
  );
  const validHash = isTransactionHash(sourceTxHash);
  const job = useQuery({
    queryKey: ['proof', sourceTxHash],
    queryFn: () => new ProofWorkerClient(config!.workerUrl).get(sourceTxHash),
    enabled: Boolean(config && validHash),
    retry: false,
    refetchInterval: (query) => {
      const phase = query.state.data?.phase;
      return phase === 'completed' ||
        phase === 'duplicate' ||
        phase === 'failed'
        ? false
        : 5_000;
    },
  });
  const progress = job.data ? progressFromJob(job.data) : undefined;

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (isTransactionHash(search.trim())) navigate(proofPath(search.trim()));
  }

  return (
    <div className="route-page proof-page">
      <PageHeading
        eyebrow="PUBLIC VERIFICATION TERMINAL"
        title="Don’t trust the unlock. Verify it."
        copy="Search a Sepolia payment and follow the evidence that Attestcoin carries into Creditcoin."
      />
      <form className="proof-search" onSubmit={submit}>
        <Search size={20} />
        <input
          aria-label="Sepolia transaction hash"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Paste a 0x Sepolia transaction hash"
        />
        <button type="submit" disabled={!isTransactionHash(search.trim())}>
          Inspect proof <ArrowRight size={16} />
        </button>
      </form>

      {sourceTxHash === 'search' ? (
        <section className="proof-intro-grid">
          <article>
            <span>01</span>
            <ShieldCheck />
            <h2>Transaction inclusion</h2>
            <p>
              The successful receipt and transaction are proven inside a covered
              canonical Sepolia block.
            </p>
          </article>
          <article>
            <span>02</span>
            <ShieldCheck />
            <h2>Continuity evidence</h2>
            <p>
              Attestcoin continuity roots bind the covered height to the
              verifier’s trusted state.
            </p>
          </article>
          <article>
            <span>03</span>
            <ShieldCheck />
            <h2>Policy execution</h2>
            <p>
              ProofKeyASC validates payer, owner, tariff, duration, target,
              expiry, and replay state.
            </p>
          </article>
        </section>
      ) : !validHash ? (
        <DataState
          kind="error"
          title="That is not a transaction hash"
          copy="Provide a 32-byte 0x-prefixed Sepolia transaction hash."
        />
      ) : job.isError ? (
        <DataState
          kind="offline"
          title="Proof record is not available"
          copy="The public relay may be unreachable or this transaction has not been submitted. The source explorer link remains independently available."
          action={
            config && (
              <a
                className="button secondary"
                href={`${config.sepoliaExplorerUrl}/tx/${sourceTxHash}`}
                target="_blank"
                rel="noreferrer"
              >
                View source transaction <ExternalLink size={14} />
              </a>
            )
          }
        />
      ) : job.isLoading ? (
        <DataState
          kind="loading"
          title="Reading Attestcoin relay state"
          copy="Checking the source payment and proof lifecycle."
        />
      ) : job.data && progress ? (
        <section className="proof-record">
          <div className="proof-record-head">
            <div>
              <span className="status available">
                <span /> {job.data.phase.replaceAll('_', ' ')}
              </span>
              <h2>{progress.label}</h2>
              <code>{sourceTxHash}</code>
            </div>
            <div className="proof-score">
              <strong>{progress.completed.length}/4</strong>
              <span>stages accepted</span>
            </div>
          </div>
          <div className="proof-invariants">
            {[
              'Successful source receipt',
              'Canonical block coverage',
              'Merkle + continuity proof',
              'Creditcoin policy execution',
            ].map((label, index) => (
              <div
                key={label}
                className={index < progress.completed.length ? 'accepted' : ''}
              >
                <span>
                  {index < progress.completed.length ? (
                    <Check size={14} />
                  ) : (
                    index + 1
                  )}
                </span>
                <strong>{label}</strong>
                <small>
                  {index < progress.completed.length ? 'Accepted' : 'Pending'}
                </small>
              </div>
            ))}
          </div>
          <div className="proof-links">
            <a
              href={`${config?.sepoliaExplorerUrl}/tx/${sourceTxHash}`}
              target="_blank"
              rel="noreferrer"
            >
              Sepolia receipt <ExternalLink size={13} />
            </a>
            {job.data.creditcoinTransactionHash && (
              <a
                href={`${config?.creditcoinExplorerUrl}/tx/${job.data.creditcoinTransactionHash}`}
                target="_blank"
                rel="noreferrer"
              >
                Creditcoin execution <ExternalLink size={13} />
              </a>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
