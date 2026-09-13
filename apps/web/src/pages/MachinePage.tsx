import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  MapPin,
  ShieldCheck,
} from 'lucide-react';
import { formatUnits } from 'ethers';
import { Link, useParams } from 'react-router';
import {
  useMachineActivity,
  useMarketplace,
  useRuntime,
} from '../app/AppProviders.js';
import {
  DataState,
  InvariantList,
  MachineArtwork,
  formatRate,
} from '../components/ProductUI.js';
import type { MachineOffer } from '../contracts.js';
import { compactHash, rentPath } from '../product.js';

export function Component() {
  const { machineId = '' } = useParams();
  const { config, configurationError } = useRuntime();
  const marketplace = useMarketplace();
  const activity = useMachineActivity(machineId);
  const machine = marketplace.data?.machines.find(
    (item) => item.machineId === machineId.toLowerCase(),
  );

  if (configurationError || !config)
    return (
      <div className="route-page">
        <DataState
          kind="error"
          title="Machine network unavailable"
          copy={configurationError ?? 'Missing configuration.'}
        />
      </div>
    );
  if (marketplace.isLoading)
    return (
      <div className="route-page">
        <DataState
          kind="loading"
          title="Verifying machine identity"
          copy="Reading registry state on Creditcoin and matching payment terms on Sepolia."
        />
      </div>
    );
  if (marketplace.isError)
    return (
      <div className="route-page">
        <DataState
          kind="offline"
          title="Machine verification failed"
          copy="Both networks must be available before ProofKey presents a machine."
          action={
            <button
              className="button secondary"
              type="button"
              onClick={() => void marketplace.refetch()}
            >
              Retry verification
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
          copy="This machine ID is not present in the indexed Creditcoin registry."
          action={
            <Link className="button secondary" to="/explore">
              Back to Explore
            </Link>
          }
        />
      </div>
    );

  const metadata = machine.metadata;
  const available = machine.status === 'available';
  const offer: MachineOffer | undefined = machine.offer
    ? {
        beneficiary: machine.offer.beneficiary,
        pricePerSecond: machine.offer.pricePerSecond,
        active: available,
        tokenAddress: machine.tokenAddress,
        tokenDecimals: machine.tokenDecimals,
        tokenSymbol: machine.tokenSymbol,
      }
    : undefined;
  const location = metadata
    ? `${metadata.location.city}, ${metadata.location.country} · ${metadata.location.site}`
    : 'Committed metadata could not be verified';

  return (
    <div className="route-page machine-detail-page">
      <Link className="back-link" to="/explore">
        <ArrowLeft size={15} /> Explore machines
      </Link>
      <section className="machine-detail-hero">
        <MachineArtwork />
        <div className="machine-detail-copy">
          <div className="card-topline">
            <span className={available ? 'status available' : 'status'}>
              <span /> {statusLabel(machine.status)}
            </span>
            <span className="chain-tag">
              <ShieldCheck size={12} />{' '}
              {machine.metadataValid
                ? 'METADATA VERIFIED'
                : 'METADATA REJECTED'}
            </span>
          </div>
          <p className="eyebrow">
            {metadata?.category?.toUpperCase() ?? 'UNVERIFIED MACHINE'}
          </p>
          <h1>{metadata?.name ?? 'Unknown machine'}</h1>
          <p className="location large">
            <MapPin size={17} /> {location}
          </p>
          <p className="detail-lead">
            {metadata?.description ??
              'The on-chain metadata digest does not match any trusted machine record. Rental is disabled.'}
          </p>
          <div className="detail-price">
            <span>Live usage rate</span>
            <strong>
              {offer ? formatRate(offer) : '—'} <small>/ minute</small>
            </strong>
          </div>
          <div className="detail-actions">
            {available ? (
              <Link
                className="button primary large"
                to={rentPath(machine.machineId)}
              >
                Book machine time <ArrowRight size={18} />
              </Link>
            ) : (
              <span
                className="button primary large disabled"
                aria-disabled="true"
              >
                Rental unavailable
              </span>
            )}
            <Link className="text-link" to="/activity">
              Device handoff from My Rentals <ExternalLink size={14} />
            </Link>
          </div>
        </div>
      </section>

      <section className="detail-grid">
        <article className="content-card">
          <p className="eyebrow">VERIFIED CONFIGURATION</p>
          <h2>One policy across two chains</h2>
          <InvariantList
            items={[
              { label: 'Machine ID', value: machine.machineId, ok: true },
              {
                label: 'Operator',
                value: machine.owner,
                ok: machine.synchronized,
              },
              {
                label: 'Device controller',
                value: machine.controller,
                ok: machine.active,
              },
              {
                label: 'Metadata commitment',
                value: machine.metadataHash,
                ok: machine.metadataValid,
              },
              {
                label: 'Owner and tariff synchronized',
                value: machine.synchronized
                  ? 'Live reads match'
                  : 'Cross-chain mismatch',
                ok: machine.synchronized,
              },
            ]}
          />
          <div className="contract-links horizontal">
            <a
              href={`${config.creditcoinExplorerUrl}/address/${config.machineRegistryAddress}`}
              target="_blank"
              rel="noreferrer"
            >
              CC3 policy <ExternalLink size={13} />
            </a>
            <a
              href={`${config.sepoliaExplorerUrl}/address/${config.registryAddress}`}
              target="_blank"
              rel="noreferrer"
            >
              Sepolia settlement <ExternalLink size={13} />
            </a>
          </div>
        </article>
        <article className="content-card dark">
          <p className="eyebrow">OPERATING PROFILE</p>
          <h2>Capability with clear safeguards.</h2>
          <div className="machine-profile-columns">
            <div>
              <strong>Capabilities</strong>
              <ul>
                {metadata?.capabilities.map((item) => (
                  <li key={item}>{item}</li>
                )) ?? <li>Metadata unavailable</li>}
              </ul>
            </div>
            <div>
              <strong>Safety requirements</strong>
              <ul>
                {metadata?.safetyRequirements.map((item) => (
                  <li key={item}>{item}</li>
                )) ?? <li>Machine blocked</li>}
              </ul>
            </div>
          </div>
          <div className="operator-identity">
            <span>Registered operator</span>
            <strong>
              {metadata?.operator.name ?? compactHash(machine.owner)}
            </strong>
            <code>{machine.owner}</code>
          </div>
        </article>
      </section>

      <section className="usage-section">
        <div className="section-heading">
          <div>
            <p className="eyebrow">RECENT USAGE / SEPOLIA</p>
            <h2>Live payment activity</h2>
          </div>
          <span className="chain-tag">
            {activity.data?.length ?? 0} RECENT RENTALS
          </span>
        </div>
        {activity.isLoading ? (
          <DataState
            kind="loading"
            title="Loading usage receipts"
            copy="Reading recent UsagePaid events."
          />
        ) : activity.isError ? (
          <DataState
            kind="offline"
            title="Usage activity unavailable"
            copy="The machine remains verified, but recent Sepolia events could not be loaded."
          />
        ) : activity.data?.length ? (
          <div className="usage-list">
            {activity.data.map((item) => (
              <article key={item.orderId}>
                <div>
                  <span>Started</span>
                  <strong>
                    {new Date(Number(item.startTime) * 1000).toLocaleString()}
                  </strong>
                </div>
                <div>
                  <span>Renter</span>
                  <strong>{compactHash(item.payer)}</strong>
                </div>
                <div>
                  <span>Paid</span>
                  <strong>
                    {formatUnits(item.amount, machine.tokenDecimals)}{' '}
                    {machine.tokenSymbol}
                  </strong>
                </div>
                <a
                  href={`${config.sepoliaExplorerUrl}/tx/${item.transactionHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  Receipt <ExternalLink size={13} />
                </a>
              </article>
            ))}
          </div>
        ) : (
          <DataState
            kind="empty"
            title="No usage payments yet"
            copy="The first verified rental will appear here directly from Sepolia."
          />
        )}
      </section>
    </div>
  );
}

function statusLabel(status: string) {
  if (status === 'available') return 'Available now';
  if (status === 'inactive') return 'Inactive';
  if (status === 'unsynchronized') return 'Cross-chain mismatch';
  return 'Metadata rejected';
}
