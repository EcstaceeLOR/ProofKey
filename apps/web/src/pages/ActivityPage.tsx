import { useQuery } from '@tanstack/react-query';
import {
  ArrowRight,
  Clock3,
  Download,
  ExternalLink,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useRuntime } from '../app/AppProviders.js';
import {
  paginateRentals,
  readOptimisticRentals,
  type RentalLifecycle,
  type RentalRecord,
} from '../activity.js';
import { DataState, PageHeading } from '../components/ProductUI.js';
import type { AppConfig } from '../contracts.js';
import {
  CreditcoinDeviceReader,
  DeviceHandoffClient,
  customerHandoffStorageKey,
  verifyUsageReceipt,
} from '../device-session.js';
import { compactHash, machinePath, proofPath, rentPath } from '../product.js';

const tabs: Array<{ value: 'all' | RentalLifecycle; label: string }> = [
  { value: 'all', label: 'All activity' },
  { value: 'pending', label: 'Pending' },
  { value: 'active', label: 'Active' },
  { value: 'expired', label: 'Expired' },
  { value: 'failed', label: 'Failed' },
  { value: 'action-required', label: 'Action required' },
];

export function Component() {
  const runtime = useRuntime();
  const [params, setParams] = useSearchParams();
  const status = (
    tabs.some((tab) => tab.value === params.get('status'))
      ? params.get('status')
      : 'all'
  ) as 'all' | RentalLifecycle;
  const page = Number(params.get('page') ?? 1) || 1;
  const optimistic =
    runtime.config && runtime.account
      ? readOptimisticRentals(
          localStorage,
          runtime.config.registryAddress,
          runtime.account,
        )
      : [];
  const activity = useQuery({
    queryKey: ['wallet-activity', runtime.account?.toLowerCase()],
    queryFn: () => runtime.activityClient!.load(runtime.account!, optimistic),
    enabled: Boolean(runtime.activityClient && runtime.account),
    retry: 1,
    staleTime: 10_000,
    refetchInterval: 15_000,
  });
  const result = paginateRentals(activity.data?.records ?? [], status, page, 6);
  const counts = Object.fromEntries(
    tabs.map((tab) => [
      tab.value,
      tab.value === 'all'
        ? (activity.data?.records.length ?? 0)
        : (activity.data?.records.filter((item) => item.status === tab.value)
            .length ?? 0),
    ]),
  );
  const setTab = (next: string) => {
    const query = new URLSearchParams();
    if (next !== 'all') query.set('status', next);
    setParams(query, { replace: true });
  };

  return (
    <div className="route-page">
      <PageHeading
        eyebrow="CUSTOMER CONTROL CENTER"
        title="Your machine access, in one place."
        copy="Recovered from Sepolia payments, relay records, Creditcoin execution, and live AccessPass state—not browser memory."
        action={
          <div className="identity-card">
            <span>CONNECTED WALLET</span>
            <strong>
              {runtime.account
                ? compactHash(runtime.account, 8, 6)
                : 'Not connected'}
            </strong>
          </div>
        }
      />

      <div
        className="tab-row activity-tabs"
        role="tablist"
        aria-label="Rental status"
      >
        {tabs.map((tab) => (
          <button
            key={tab.value}
            role="tab"
            aria-selected={status === tab.value}
            className={status === tab.value ? 'active' : ''}
            type="button"
            onClick={() => setTab(tab.value)}
          >
            {tab.label}
            <span>{counts[tab.value]}</span>
          </button>
        ))}
      </div>

      {!runtime.account ? (
        <DataState
          kind="empty"
          title="Connect a wallet to recover rentals"
          copy="ProofKey scopes every Sepolia payment and Creditcoin credential to the connected payer address."
          action={
            <button
              className="button primary"
              type="button"
              onClick={runtime.openWallet}
            >
              Connect wallet
            </button>
          }
        />
      ) : activity.isLoading ? (
        <div className="activity-list" aria-label="Loading wallet history">
          {[0, 1, 2].map((item) => (
            <div className="activity-skeleton" key={item} />
          ))}
        </div>
      ) : activity.isError ? (
        <DataState
          kind="offline"
          title="Wallet history could not be reconciled"
          copy="ProofKey could not safely correlate Sepolia, relay, and Creditcoin state. No access status was inferred."
          action={
            <button
              className="button secondary"
              type="button"
              onClick={() => void activity.refetch()}
            >
              Retry all sources
            </button>
          }
        />
      ) : result.items.length ? (
        <>
          <div className="activity-index-state">
            <span>
              <RefreshCw size={12} /> Live correlation
            </span>
            <span>
              CC3 time{' '}
              {new Date(
                (activity.data?.creditcoinTimestamp ?? 0) * 1000,
              ).toLocaleString()}
            </span>
            <span>
              Updated{' '}
              {activity.data &&
                new Date(activity.data.indexedAt).toLocaleTimeString()}
            </span>
          </div>
          <div className="activity-list">
            {result.items.map((record) => (
              <RentalRow
                key={`${record.sourceTransactionHash}:${record.orderId ?? 'pending'}`}
                record={record}
                config={runtime.config!}
                machineName={
                  record.machineId.toLowerCase() ===
                  runtime.config?.machineId.toLowerCase()
                    ? runtime.config.machineName
                    : undefined
                }
              />
            ))}
          </div>
          {result.totalPages > 1 && (
            <nav className="pagination" aria-label="Rental history pages">
              <button
                type="button"
                disabled={result.page === 1}
                onClick={() => updatePage(params, setParams, result.page - 1)}
              >
                Previous
              </button>
              <span>
                Page {result.page} of {result.totalPages}
              </span>
              <button
                type="button"
                disabled={result.page === result.totalPages}
                onClick={() => updatePage(params, setParams, result.page + 1)}
              >
                Next
              </button>
            </nav>
          )}
        </>
      ) : (
        <DataState
          kind="empty"
          title={
            status === 'all'
              ? 'No rentals found for this wallet'
              : `No ${status.replace('-', ' ')} rentals`
          }
          copy={
            status === 'all'
              ? 'A confirmed UsagePaid event from this wallet will appear here even in a fresh browser.'
              : 'Choose another tab to inspect the rest of your wallet history.'
          }
          action={
            status === 'all' ? (
              <Link className="button primary" to="/explore">
                Find a machine <ArrowRight size={15} />
              </Link>
            ) : (
              <button
                className="button secondary"
                type="button"
                onClick={() => setTab('all')}
              >
                Show all activity
              </button>
            )
          }
        />
      )}

      <section className="activity-help">
        <div>
          <ShieldCheck size={20} />
          <div>
            <strong>Four-source verification</strong>
            <p>
              Every state is correlated across UsagePaid, the relay index,
              ProofKeyASC, and AccessPass.
            </p>
          </div>
        </div>
        <a
          href={runtime.config?.creditcoinExplorerUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open CC3 explorer <ExternalLink size={14} />
        </a>
      </section>
    </div>
  );
}

function RentalRow({
  record,
  config,
  machineName,
}: {
  record: RentalRecord;
  config: NonNullable<ReturnType<typeof useRuntime>['config']>;
  machineName?: string;
}) {
  return (
    <article className={`rental-row ${record.status}`}>
      <div className="activity-icon">
        <StatusIcon status={record.status} />
      </div>
      <div className="activity-main">
        <span>
          {record.optimistic ? 'LOCAL PENDING RECEIPT' : 'ON-CHAIN RENTAL'}
        </span>
        <h2>
          {machineName ?? `Machine ${compactHash(record.machineId, 8, 5)}`}
        </h2>
        <Link to={machinePath(record.machineId)}>
          {compactHash(record.machineId, 12, 8)}
        </Link>
      </div>
      <div className="rental-lifecycle">
        <span className={`rental-status ${record.status}`}>
          {record.status.replace('-', ' ')}
        </span>
        <strong>{record.stateLabel}</strong>
        <small>{record.nextAction}</small>
        {record.status === 'active' && record.expiresAt && (
          <Countdown expiresAt={record.expiresAt} />
        )}
        {record.diagnostic && <em>{record.diagnostic}</em>}
        <RentalReceiptEvidence record={record} config={config} />
      </div>
      <div className="rental-evidence">
        <a
          href={`${config.sepoliaExplorerUrl}/tx/${record.sourceTransactionHash}`}
          target="_blank"
          rel="noreferrer"
        >
          Sepolia <ExternalLink size={12} />
        </a>
        <Link to={proofPath(record.sourceTransactionHash)}>
          Proof <ShieldCheck size={12} />
        </Link>
        {record.creditcoinTransactionHash && (
          <a
            href={`${config.creditcoinExplorerUrl}/tx/${record.creditcoinTransactionHash}`}
            target="_blank"
            rel="noreferrer"
          >
            Creditcoin <ExternalLink size={12} />
          </a>
        )}
      </div>
      <div className="activity-actions">
        {record.status === 'active' ? (
          <Link
            className="button primary"
            to={`/sessions/${record.sourceTransactionHash}`}
          >
            Start session <ArrowRight size={14} />
          </Link>
        ) : record.status === 'expired' ? (
          <Link className="button secondary" to={rentPath(record.machineId)}>
            Rent again
          </Link>
        ) : (
          <Link
            className="button secondary"
            to={`${rentPath(record.machineId)}?resume=${record.sourceTransactionHash}`}
          >
            {record.status === 'pending' ? 'Track' : 'Resume'}{' '}
            <ArrowRight size={14} />
          </Link>
        )}
        <button
          className="receipt-download"
          type="button"
          onClick={() => downloadReceipt(record)}
          aria-label="Download receipt JSON"
        >
          <Download size={15} />
        </button>
      </div>
    </article>
  );
}

function RentalReceiptEvidence({
  record,
  config,
}: {
  record: RentalRecord;
  config: AppConfig;
}) {
  const nonce = localStorage.getItem(
    customerHandoffStorageKey(record.sourceTransactionHash),
  );
  const evidence = useQuery({
    queryKey: ['signed-usage-receipt', nonce],
    queryFn: async () => {
      const handoff = await new DeviceHandoffClient(config.workerUrl).get(
        nonce!,
      );
      const authorization = await new CreditcoinDeviceReader(config).read(
        handoff.machineId,
        handoff.payer,
      );
      const receipt = handoff.endReceipt ?? handoff.startReceipt;
      return {
        handoff,
        receipt,
        verification: receipt
          ? verifyUsageReceipt(receipt, handoff, authorization.controller)
          : undefined,
      };
    },
    enabled: Boolean(nonce),
    staleTime: 4_000,
    refetchInterval: 5_000,
    retry: false,
  });
  if (!evidence.data?.receipt) return null;
  return (
    <div
      className={`rental-signed-proof ${evidence.data.verification?.valid ? 'verified' : 'invalid'}`}
    >
      <ShieldCheck size={13} />
      <span>
        {evidence.data.handoff.endReceipt
          ? 'Signed usage receipt'
          : 'Signed start receipt'}
      </span>
      <small>
        {evidence.data.verification?.valid
          ? 'Controller verified locally'
          : 'Signature verification failed'}
      </small>
    </div>
  );
}

function StatusIcon({ status }: { status: RentalLifecycle }) {
  return status === 'active' ? (
    <ShieldCheck size={21} />
  ) : status === 'pending' ? (
    <RefreshCw className="spin" size={20} />
  ) : (
    <Clock3 size={21} />
  );
}

function Countdown({ expiresAt }: { expiresAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const remaining = Math.max(0, expiresAt * 1000 - now);
  const hours = Math.floor(remaining / 3_600_000);
  const minutes = Math.floor((remaining % 3_600_000) / 60_000);
  const seconds = Math.floor((remaining % 60_000) / 1000);
  return (
    <time dateTime={new Date(expiresAt * 1000).toISOString()}>
      {hours}h {minutes}m {seconds}s remaining
    </time>
  );
}

function downloadReceipt(record: RentalRecord) {
  const payload = JSON.stringify(
    {
      schema: 'proofkey.rental-receipt.v1',
      exportedAt: new Date().toISOString(),
      rental: record,
    },
    null,
    2,
  );
  const url = URL.createObjectURL(
    new Blob([payload], { type: 'application/json' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `proofkey-${record.orderId ?? record.sourceTransactionHash}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function updatePage(
  params: URLSearchParams,
  setParams: ReturnType<typeof useSearchParams>[1],
  page: number,
) {
  const next = new URLSearchParams(params);
  next.set('page', String(page));
  setParams(next, { replace: true });
}
