import {
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  MapPin,
  ShieldCheck,
} from 'lucide-react';
import { Link, useParams } from 'react-router';
import { useMachineOffer, useRuntime } from '../app/AppProviders.js';
import {
  DataState,
  InvariantList,
  MachineArtwork,
  formatRate,
} from '../components/ProductUI.js';
import { compactHash, rentPath } from '../product.js';

export function Component() {
  const { machineId = '' } = useParams();
  const { config, configurationError } = useRuntime();
  const offer = useMachineOffer();

  if (configurationError || !config) {
    return (
      <div className="route-page">
        <DataState
          kind="error"
          title="Machine configuration unavailable"
          copy={configurationError ?? 'Missing configuration.'}
        />
      </div>
    );
  }
  if (machineId.toLowerCase() !== config.machineId.toLowerCase()) {
    return (
      <div className="route-page">
        <DataState
          kind="empty"
          title="Machine not found"
          copy="This machine ID is not present in the current indexed network."
          action={
            <Link className="button secondary" to="/explore">
              Back to Explore
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="route-page machine-detail-page">
      <Link className="back-link" to="/explore">
        <ArrowLeft size={15} /> Explore machines
      </Link>
      <section className="machine-detail-hero">
        <MachineArtwork />
        <div className="machine-detail-copy">
          <div className="card-topline">
            <span
              className={offer.data?.active ? 'status available' : 'status'}
            >
              <span />{' '}
              {offer.isLoading
                ? 'Checking chain'
                : offer.data?.active
                  ? 'Available now'
                  : 'Unavailable'}
            </span>
            <span className="chain-tag">
              <ShieldCheck size={12} /> POLICY VERIFIED
            </span>
          </div>
          <p className="eyebrow">INDUSTRIAL / HEAVY EQUIPMENT</p>
          <h1>{config.machineName}</h1>
          <p className="location large">
            <MapPin size={17} /> {config.machineLocation}
          </p>
          <p className="detail-lead">
            Reserve verified operating time without deposits, platform custody,
            or a cross-chain asset bridge. Your successful payment becomes the
            access credential.
          </p>
          <div className="detail-price">
            <span>Live usage rate</span>
            <strong>
              {offer.data ? formatRate(offer.data) : '—'}{' '}
              <small>/ minute</small>
            </strong>
          </div>
          <div className="detail-actions">
            <Link
              className="button primary large"
              to={rentPath(config.machineId)}
            >
              Book machine time <ArrowRight size={18} />
            </Link>
            <Link className="text-link" to={`/device/${config.machineId}`}>
              Open device terminal <ExternalLink size={14} />
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
              { label: 'Machine ID', value: config.machineId, ok: true },
              {
                label: 'CC3 registry',
                value: config.machineRegistryAddress,
                ok: !offer.isError,
              },
              {
                label: 'Sepolia settlement',
                value: config.registryAddress,
                ok: !offer.isError,
              },
              {
                label: 'Owner and tariff synchronized',
                value: offer.data
                  ? 'Live contract reads match'
                  : 'Checking live state',
                ok: Boolean(offer.data),
              },
            ]}
          />
        </article>
        <article className="content-card dark">
          <p className="eyebrow">WHY IT IS SAFE</p>
          <h2>The relay cannot create your key.</h2>
          <p>
            Creditcoin grants access only after its native verifier accepts the
            Attestcoin transaction, receipt, Merkle, and continuity proof.
          </p>
          <div className="contract-links">
            <a
              href={`${config.creditcoinExplorerUrl}/address/${config.machineRegistryAddress}`}
              target="_blank"
              rel="noreferrer"
            >
              MachineRegistry {compactHash(config.machineRegistryAddress)}{' '}
              <ExternalLink size={13} />
            </a>
            <a
              href={`${config.sepoliaExplorerUrl}/address/${config.registryAddress}`}
              target="_blank"
              rel="noreferrer"
            >
              Payment registry {compactHash(config.registryAddress)}{' '}
              <ExternalLink size={13} />
            </a>
          </div>
        </article>
      </section>
    </div>
  );
}
