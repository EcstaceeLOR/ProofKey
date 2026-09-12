import {
  Check,
  ExternalLink,
  Settings2,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { useMachineOffer, useRuntime } from '../app/AppProviders.js';
import {
  DataState,
  InvariantList,
  PageHeading,
  formatRate,
} from '../components/ProductUI.js';
import { compactHash } from '../product.js';

export function Component() {
  const { config, account } = useRuntime();
  const offer = useMachineOffer();
  if (!config)
    return (
      <div className="route-page">
        <DataState
          kind="error"
          title="Operator configuration unavailable"
          copy="Configure both registry addresses before opening the control center."
        />
      </div>
    );

  const isOwner = Boolean(
    account &&
    offer.data &&
    account.toLowerCase() === offer.data.beneficiary.toLowerCase(),
  );
  return (
    <div className="route-page">
      <PageHeading
        eyebrow="OPERATOR CONTROL CENTER"
        title="Keep machine policy synchronized."
        copy="Monitor the Creditcoin machine identity and its Sepolia commercial offer from one operational view."
        action={
          <div className={isOwner ? 'owner-badge active' : 'owner-badge'}>
            <ShieldCheck size={18} />
            <div>
              <span>OWNER SESSION</span>
              <strong>
                {isOwner
                  ? 'Verified'
                  : account
                    ? 'Read only'
                    : 'Wallet required'}
              </strong>
            </div>
          </div>
        }
      />
      <section className="operator-grid">
        <article className="operator-machine">
          <div className="operator-machine-head">
            <span
              className={offer.data?.active ? 'status available' : 'status'}
            >
              <span />{' '}
              {offer.data?.active
                ? 'Accepting rentals'
                : 'Not accepting rentals'}
            </span>
            <Settings2 size={20} />
          </div>
          <p className="eyebrow">MACHINE / 001</p>
          <h2>{config.machineName}</h2>
          <code>{compactHash(config.machineId, 14, 10)}</code>
          <div className="operator-metrics">
            <div>
              <span>Current rate</span>
              <strong>
                {offer.data ? formatRate(offer.data) : 'Loading…'}
              </strong>
            </div>
            <div>
              <span>Controller state</span>
              <strong>{offer.isError ? 'Unavailable' : 'Synchronized'}</strong>
            </div>
          </div>
        </article>
        <article className="content-card">
          <p className="eyebrow">CROSS-CHAIN READINESS</p>
          <h2>Deployment integrity</h2>
          <InvariantList
            items={[
              {
                label: 'Sepolia payment registry',
                value: config.registryAddress,
                ok: true,
              },
              {
                label: 'Creditcoin machine registry',
                value: config.machineRegistryAddress,
                ok: true,
              },
              {
                label: 'Beneficiary and owner',
                value: offer.data?.beneficiary ?? 'Checking',
                ok: Boolean(offer.data),
              },
              {
                label: 'Tariff synchronization',
                value: offer.data ? 'Exact match' : 'Checking',
                ok: Boolean(offer.data),
              },
            ]}
          />
        </article>
      </section>
      <section className="operator-actions">
        <div>
          <Wrench size={21} />
          <div>
            <strong>Registry operations</strong>
            <p>
              Current deployment remains owner-controlled at the contracts.
              Product V1 mutation controls will require an owner wallet and
              explicit chain confirmation.
            </p>
          </div>
        </div>
        <div className="contract-links horizontal">
          <a
            href={`${config.creditcoinExplorerUrl}/address/${config.machineRegistryAddress}`}
            target="_blank"
            rel="noreferrer"
          >
            Read CC3 registry <ExternalLink size={13} />
          </a>
          <a
            href={`${config.sepoliaExplorerUrl}/address/${config.registryAddress}`}
            target="_blank"
            rel="noreferrer"
          >
            Read payment offer <ExternalLink size={13} />
          </a>
        </div>
      </section>
    </div>
  );
}
