import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Clock3,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { Link } from 'react-router';
import { useRuntime } from '../app/AppProviders.js';
import { DataState, PageHeading } from '../components/ProductUI.js';
import { progressFromJob } from '../flow.js';
import { compactHash, proofPath, rentalStorageKey } from '../product.js';
import { ProofWorkerClient } from '../worker.js';

export function Component() {
  const { config, account } = useRuntime();
  const storageKey = config
    ? rentalStorageKey(config.registryAddress, config.machineId)
    : '';
  const sourceTransactionHash = storageKey
    ? localStorage.getItem(storageKey)
    : undefined;
  const job = useQuery({
    queryKey: ['relay-job', sourceTransactionHash],
    queryFn: () =>
      new ProofWorkerClient(config!.workerUrl).get(sourceTransactionHash!),
    enabled: Boolean(config && sourceTransactionHash),
    refetchInterval: 5_000,
    retry: false,
  });
  const progress = job.data ? progressFromJob(job.data) : undefined;

  return (
    <div className="route-page">
      <PageHeading
        eyebrow="CUSTOMER CONTROL CENTER"
        title="Your machine access, in one place."
        copy="Track pending payments, resume cross-chain proofs, and return to active or expired access without trusting browser memory as the final authority."
        action={
          <div className="identity-card">
            <span>CONNECTED WALLET</span>
            <strong>
              {account ? compactHash(account, 8, 6) : 'Not connected'}
            </strong>
          </div>
        }
      />
      <div className="tab-row" role="tablist" aria-label="Rental status">
        <button className="active" type="button">
          All activity
        </button>
        <button type="button">Pending</button>
        <button type="button">Active</button>
        <button type="button">Expired</button>
      </div>

      {!account ? (
        <DataState
          kind="empty"
          title="Connect a wallet to view rentals"
          copy="Your payment and access history will be scoped to the connected payer address."
        />
      ) : sourceTransactionHash ? (
        <article className="activity-card">
          <div className="activity-icon">
            <Clock3 size={21} />
          </div>
          <div className="activity-main">
            <span>PENDING CROSS-CHAIN RENTAL</span>
            <h2>{config?.machineName}</h2>
            <code>{compactHash(sourceTransactionHash, 14, 10)}</code>
          </div>
          <div className="activity-state">
            <span>
              {job.isFetching && <RefreshCw className="spin" size={13} />}{' '}
              {progress?.label ??
                (job.isError
                  ? 'Relay temporarily unreachable'
                  : 'Loading relay state')}
            </span>
            <strong>{progress?.verified ? 'VERIFIED' : 'IN PROGRESS'}</strong>
          </div>
          <div className="activity-actions">
            <Link
              className="button secondary"
              to={`/rent/${config?.machineId}`}
            >
              Resume <ArrowRight size={15} />
            </Link>
            <Link
              className="icon-link"
              to={proofPath(sourceTransactionHash)}
              aria-label="Open proof"
            >
              <ShieldCheck size={18} />
            </Link>
          </div>
        </article>
      ) : (
        <DataState
          kind="empty"
          title="No pending rentals"
          copy="A payment made from this browser will appear here immediately and remain resumable until Creditcoin verification completes."
          action={
            <Link className="button primary" to="/explore">
              Find a machine <ArrowRight size={15} />
            </Link>
          }
        />
      )}

      <section className="activity-help">
        <div>
          <ShieldCheck size={20} />
          <div>
            <strong>History is independently verifiable</strong>
            <p>
              Every completed row links to both the source payment and
              Creditcoin authorization transaction.
            </p>
          </div>
        </div>
        <a
          href="https://creditcoin-testnet.blockscout.com"
          target="_blank"
          rel="noreferrer"
        >
          Open CC3 explorer <ExternalLink size={14} />
        </a>
      </section>
    </div>
  );
}
