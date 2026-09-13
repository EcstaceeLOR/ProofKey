import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowRight,
  Blocks,
  Check,
  CircleAlert,
  Database,
  ExternalLink,
  FileUp,
  Gauge,
  LoaderCircle,
  Plus,
  RefreshCw,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Wallet,
  Wrench,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useMarketplace, useRuntime } from '../app/AppProviders.js';
import { DataState, PageHeading } from '../components/ProductUI.js';
import type { MarketplaceMachine } from '../marketplace.js';
import {
  OperatorClient,
  clearOperatorSession,
  createOperatorSession,
  emptyMachineDraft,
  loadOperatorSession,
  machineIdFromLabel,
  saveOperatorSession,
  updateOperatorSession,
  validateMachineDraft,
  type MachineDraft,
  type OperatorSession,
} from '../operator.js';
import { compactHash, describeError, machinePath } from '../product.js';

type View = 'inventory' | 'onboard';

export function Component() {
  const { config, account, walletProvider, openWallet } = useRuntime();
  const marketplace = useMarketplace();
  const queryClient = useQueryClient();
  const client = useMemo(
    () => (config ? new OperatorClient(config) : undefined),
    [config],
  );
  const authority = useQuery({
    queryKey: ['operator-authority', config?.registryAddress],
    queryFn: () => client!.loadAuthority(),
    enabled: Boolean(client),
  });
  const [view, setView] = useState<View>('inventory');
  const [draft, setDraft] = useState<MachineDraft>(emptyMachineDraft);
  const [session, setSession] = useState<OperatorSession>();
  const [busy, setBusy] = useState<string>();
  const [error, setError] = useState<string>();
  const [editing, setEditing] = useState<MarketplaceMachine>();

  useEffect(() => {
    if (!account) {
      setSession(undefined);
      return;
    }
    const saved = loadOperatorSession(account);
    setSession(saved);
    setDraft(
      saved?.draft ?? {
        ...emptyMachineDraft,
        controller: account,
      },
    );
    if (saved) setView('onboard');
  }, [account]);

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

  const ownedMachines = (marketplace.data?.machines ?? []).filter(
    (machine) =>
      account && machine.owner.toLowerCase() === account.toLowerCase(),
  );
  const registryOwner = Boolean(
    account &&
    authority.data &&
    authority.data.paymentRegistryOwner.toLowerCase() === account.toLowerCase(),
  );

  const saveSession = (next: OperatorSession) => {
    saveOperatorSession(next);
    setSession(next);
    setDraft(next.draft);
  };

  const execute = async (label: string, operation: () => Promise<void>) => {
    setBusy(label);
    setError(undefined);
    try {
      await operation();
      await queryClient.invalidateQueries({ queryKey: ['marketplace'] });
    } catch (reason) {
      setError(describeError(reason));
    } finally {
      setBusy(undefined);
    }
  };

  const uploadMetadata = () =>
    execute('metadata', async () => {
      if (!account || !client) throw new Error('Connect the operator wallet.');
      const next = session ?? createOperatorSession(account, draft);
      const metadata = await client.uploadMetadata(draft, account);
      saveSession(
        updateOperatorSession(next, {
          draft,
          machineId: machineIdFromLabel(draft.label),
          metadata,
          phase: 'metadata_uploaded',
        }),
      );
    });

  const registerMachine = () =>
    execute('creditcoin', async () => {
      if (!session || !client || !walletProvider)
        throw new Error('The uploaded onboarding session is not ready.');
      const transactionHash = await client.registerMachine(
        session,
        walletProvider,
      );
      saveSession(
        updateOperatorSession(session, {
          creditcoinTransactionHash: transactionHash,
          phase: 'cc3_confirmed',
        }),
      );
    });

  const synchronizeOffer = () =>
    execute('sepolia', async () => {
      if (!session || !client || !walletProvider)
        throw new Error('The Creditcoin registration is not ready.');
      if (!registryOwner)
        throw new Error(
          `Sepolia offer updates require registry owner ${authority.data?.paymentRegistryOwner ?? 'unknown'}.`,
        );
      const transactionHash = await client.synchronizeOffer(
        session,
        walletProvider,
      );
      saveSession(
        updateOperatorSession(session, {
          sepoliaTransactionHash: transactionHash,
          phase: 'complete',
        }),
      );
    });

  const startNew = () => {
    if (account) clearOperatorSession(account);
    setSession(undefined);
    setDraft({ ...emptyMachineDraft, controller: account ?? '' });
    setError(undefined);
  };

  return (
    <div className="route-page operator-page">
      <PageHeading
        eyebrow="OPERATOR CONTROL CENTER"
        title="Publish machines. Keep policy aligned."
        copy="Onboard real equipment without scripts, then detect and repair configuration drift across Creditcoin and Sepolia."
        action={
          <div className={account ? 'owner-badge active' : 'owner-badge'}>
            <ShieldCheck size={18} />
            <div>
              <span>OPERATOR SESSION</span>
              <strong>
                {account ? compactHash(account) : 'Wallet required'}
              </strong>
            </div>
          </div>
        }
      />

      <div className="operator-tabs" role="tablist">
        <button
          type="button"
          className={view === 'inventory' ? 'active' : ''}
          onClick={() => setView('inventory')}
        >
          <Blocks size={15} /> Owned machines
          <span>{ownedMachines.length}</span>
        </button>
        <button
          type="button"
          className={view === 'onboard' ? 'active' : ''}
          onClick={() => setView('onboard')}
        >
          <Plus size={15} /> Onboard machine
          {session && <i />}
        </button>
      </div>

      {error && (
        <div className="operator-error" role="alert">
          <CircleAlert size={18} />
          <span>
            <strong>Transaction not completed</strong>
            {error}
          </span>
          <button type="button" onClick={() => setError(undefined)}>
            Dismiss
          </button>
        </div>
      )}

      {!account ? (
        <section className="operator-connect">
          <div>
            <Wallet />
            <h2>Connect the owner wallet</h2>
            <p>
              Ownership is read directly from Creditcoin. Mutation controls stay
              disabled until the matching account is connected.
            </p>
          </div>
          <button type="button" onClick={openWallet}>
            Connect wallet <ArrowRight size={15} />
          </button>
        </section>
      ) : view === 'inventory' ? (
        <Inventory
          machines={ownedMachines}
          loading={marketplace.isLoading}
          error={marketplace.isError}
          registryOwner={registryOwner}
          config={config}
          busy={busy}
          onRefresh={() => void marketplace.refetch()}
          onManage={setEditing}
          onRepair={(machine) =>
            void execute('repair', async () => {
              if (!client || !walletProvider || !account)
                throw new Error('Wallet is not ready.');
              if (!registryOwner)
                throw new Error('Connect the Sepolia payment-registry owner.');
              await client.repairOffer(
                machine.machineId,
                machine.owner,
                machine.tariff,
                machine.active,
                account,
                walletProvider,
              );
            })
          }
        />
      ) : (
        <OnboardingWizard
          draft={draft}
          setDraft={setDraft}
          session={session}
          busy={busy}
          registryOwner={registryOwner}
          registryOwnerAddress={authority.data?.paymentRegistryOwner}
          onUpload={() => void uploadMetadata()}
          onRegister={() => void registerMachine()}
          onSynchronize={() => void synchronizeOffer()}
          onReset={startNew}
          config={config}
        />
      )}

      {editing && account && client && walletProvider && (
        <MachineEditor
          machine={editing}
          account={account}
          registryOwner={registryOwner}
          client={client}
          walletProvider={walletProvider}
          busy={busy}
          onClose={() => setEditing(undefined)}
          execute={execute}
        />
      )}
    </div>
  );
}

interface InventoryProps {
  machines: MarketplaceMachine[];
  loading: boolean;
  error: boolean;
  registryOwner: boolean;
  config: NonNullable<ReturnType<typeof useRuntime>['config']>;
  busy?: string;
  onRefresh: () => void;
  onManage: (machine: MarketplaceMachine) => void;
  onRepair: (machine: MarketplaceMachine) => void;
}

function Inventory(props: InventoryProps) {
  if (props.loading)
    return (
      <DataState
        kind="loading"
        title="Loading owned machines"
        copy="Reading both registries and resolving metadata commitments."
      />
    );
  if (props.error)
    return (
      <DataState
        kind="offline"
        title="Inventory is unavailable"
        copy="No ownership or synchronization state was inferred."
        action={
          <button
            className="button secondary"
            type="button"
            onClick={props.onRefresh}
          >
            Retry
          </button>
        }
      />
    );
  if (!props.machines.length)
    return (
      <DataState
        kind="empty"
        title="No machines owned by this wallet"
        copy="Open Onboard machine to publish the first Creditcoin identity and Sepolia offer."
      />
    );
  return (
    <section className="operator-inventory">
      <div className="operator-section-head">
        <div>
          <span>LIVE INVENTORY</span>
          <h2>Cross-chain machine control</h2>
        </div>
        <button type="button" onClick={props.onRefresh}>
          <RefreshCw size={14} /> Refresh state
        </button>
      </div>
      <div className="operator-inventory-grid">
        {props.machines.map((machine) => (
          <article key={machine.machineId} className="operator-inventory-card">
            <div className="operator-machine-head">
              <span
                className={
                  machine.status === 'available' ? 'status available' : 'status'
                }
              >
                <span /> {statusLabel(machine)}
              </span>
              <Settings2 size={18} />
            </div>
            <p className="eyebrow">
              {machine.metadata?.category ?? 'UNVERIFIED METADATA'}
            </p>
            <h3>
              {machine.metadata?.name ?? compactHash(machine.machineId, 12, 8)}
            </h3>
            <code>{compactHash(machine.machineId, 14, 10)}</code>
            <DriftChecks machine={machine} />
            <div className="operator-card-actions">
              <Link to={machinePath(machine.machineId)}>
                View profile <ExternalLink size={12} />
              </Link>
              <button type="button" onClick={() => props.onManage(machine)}>
                Manage
              </button>
              {!machine.synchronized && (
                <button
                  type="button"
                  disabled={!props.registryOwner || Boolean(props.busy)}
                  onClick={() => props.onRepair(machine)}
                >
                  {props.busy === 'repair' ? (
                    <LoaderCircle className="spinner" size={13} />
                  ) : (
                    <Wrench size={13} />
                  )}{' '}
                  Repair offer
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      <div className="operator-contract-strip">
        <span>
          <Database size={14} /> MachineRegistry{' '}
          <code>{compactHash(props.config.machineRegistryAddress)}</code>
        </span>
        <ArrowRight size={14} />
        <span>
          <Gauge size={14} /> UsagePaymentRegistry{' '}
          <code>{compactHash(props.config.registryAddress)}</code>
        </span>
      </div>
    </section>
  );
}

function DriftChecks({ machine }: { machine: MarketplaceMachine }) {
  const checks = [
    [
      'Owner / beneficiary',
      machine.owner,
      machine.offer?.beneficiary,
      Boolean(
        machine.offer &&
        machine.owner.toLowerCase() === machine.offer.beneficiary.toLowerCase(),
      ),
    ],
    [
      'Tariff',
      machine.tariff.toString(),
      machine.offer?.pricePerSecond.toString(),
      machine.offer?.pricePerSecond === machine.tariff,
    ],
    [
      'Active state',
      String(machine.active),
      machine.offer ? String(machine.offer.active) : undefined,
      Boolean(machine.offer && machine.active === machine.offer.active),
    ],
    [
      'Metadata digest',
      machine.metadataHash,
      machine.metadata?.uri,
      machine.metadataValid,
    ],
  ] as const;
  return (
    <div className="operator-drift-table">
      {checks.map(([label, creditcoin, sepolia, ok]) => (
        <div key={label} className={ok ? 'ok' : 'drift'}>
          <span>
            {ok ? <Check size={11} /> : <CircleAlert size={11} />}
            {label}
          </span>
          <small title={creditcoin}>CC3 {compactHash(creditcoin, 10, 6)}</small>
          <small title={sepolia}>
            SEP {sepolia ? compactHash(sepolia, 10, 6) : 'missing'}
          </small>
        </div>
      ))}
    </div>
  );
}

interface WizardProps {
  draft: MachineDraft;
  setDraft: React.Dispatch<React.SetStateAction<MachineDraft>>;
  session?: OperatorSession;
  busy?: string;
  registryOwner: boolean;
  registryOwnerAddress?: string;
  onUpload: () => void;
  onRegister: () => void;
  onSynchronize: () => void;
  onReset: () => void;
  config: NonNullable<ReturnType<typeof useRuntime>['config']>;
}

function OnboardingWizard(props: WizardProps) {
  const step = !props.session
    ? 0
    : props.session.phase === 'metadata_uploaded'
      ? 1
      : props.session.phase === 'cc3_confirmed'
        ? 2
        : 3;
  const errors = validateMachineDraft(props.draft);
  const update = (key: keyof MachineDraft, value: string | boolean) =>
    props.setDraft((current) => ({ ...current, [key]: value }));
  return (
    <section className="onboarding-console">
      <div className="wizard-rail">
        {[
          ['Metadata', 'Upload content-addressed profile'],
          ['Creditcoin', 'Register identity and policy'],
          ['Sepolia', 'Publish commercial offer'],
          ['Ready', 'Machine enters marketplace'],
        ].map(([title, copy], index) => (
          <div
            key={title}
            className={
              index < step ? 'complete' : index === step ? 'active' : ''
            }
          >
            <span>{index < step ? <Check size={13} /> : index + 1}</span>
            <div>
              <strong>{title}</strong>
              <small>{copy}</small>
            </div>
          </div>
        ))}
      </div>
      <div className="wizard-panel">
        {step === 0 ? (
          <>
            <div className="operator-section-head">
              <div>
                <span>STEP 1 / MACHINE PROFILE</span>
                <h2>Build verifiable metadata</h2>
              </div>
              <FileUp />
            </div>
            <p className="wizard-copy">
              The relay stores a canonical JSON document in PostgreSQL under its
              content digest. The returned URI is committed on Creditcoin
              exactly.
            </p>
            <div className="operator-form-grid">
              <Field
                label="Permanent machine label"
                value={props.draft.label}
                onChange={(value) => update('label', value)}
                placeholder="fleet.loader.042"
              />
              <Field
                label="Display name"
                value={props.draft.name}
                onChange={(value) => update('name', value)}
                placeholder="Autonomous Wheel Loader"
              />
              <Field
                label="Category"
                value={props.draft.category}
                onChange={(value) => update('category', value)}
                placeholder="Construction"
              />
              <Field
                label="Controller wallet"
                value={props.draft.controller}
                onChange={(value) => update('controller', value)}
                placeholder="0x…"
                mono
              />
              <Field
                label="City"
                value={props.draft.city}
                onChange={(value) => update('city', value)}
                placeholder="Lagos"
              />
              <Field
                label="Country"
                value={props.draft.country}
                onChange={(value) => update('country', value)}
                placeholder="Nigeria"
              />
              <Field
                label="Site / bay"
                value={props.draft.site}
                onChange={(value) => update('site', value)}
                placeholder="Lekki Yard · Bay 2"
              />
              <Field
                label="Tariff (token units / second)"
                value={props.draft.tariff}
                onChange={(value) => update('tariff', value)}
                placeholder="2500"
                mono
              />
              <label className="wide">
                <span>Description</span>
                <textarea
                  value={props.draft.description}
                  onChange={(event) =>
                    update('description', event.target.value)
                  }
                  placeholder="What this machine does and where proof-gated access matters."
                />
              </label>
              <Field
                label="Capabilities (comma separated)"
                value={props.draft.capabilities}
                onChange={(value) => update('capabilities', value)}
                placeholder="GPS telemetry, remote controller"
                wide
              />
              <Field
                label="Safety requirements"
                value={props.draft.safetyRequirements}
                onChange={(value) => update('safetyRequirements', value)}
                placeholder="Operator briefing, PPE"
                wide
              />
            </div>
            <div className="wizard-commit-preview">
              <span>Derived machine ID</span>
              <code>
                {props.draft.label.trim().length >= 3
                  ? machineIdFromLabel(props.draft.label)
                  : 'Complete the permanent label'}
              </code>
            </div>
            <button
              className="wizard-primary"
              type="button"
              disabled={Boolean(errors.length || props.busy)}
              onClick={props.onUpload}
            >
              {props.busy === 'metadata' ? (
                <LoaderCircle className="spinner" />
              ) : (
                <FileUp />
              )}{' '}
              Upload metadata and lock commitment <ArrowRight />
            </button>
            {errors[0] && (
              <small className="wizard-validation">{errors[0]}</small>
            )}
          </>
        ) : step === 1 && props.session?.metadata ? (
          <TransactionStep
            eyebrow="STEP 2 / CREDITCOIN CC3"
            title="Register the machine identity"
            copy="Your wallet switches to Creditcoin CC3. MachineRegistry records owner, controller, metadata commitment, tariff, and active state atomically."
            network="Creditcoin CC3 · 102031"
            items={[
              ['Machine ID', props.session.machineId],
              ['Metadata URI', props.session.metadata.uri],
              ['Commitment', props.session.metadata.commitment],
              ['Controller', props.session.draft.controller],
              ['Tariff', props.session.draft.tariff],
            ]}
            busy={props.busy === 'creditcoin'}
            button="Confirm CC3 registration"
            onClick={props.onRegister}
          />
        ) : step === 2 && props.session ? (
          <TransactionStep
            eyebrow="STEP 3 / ETHEREUM SEPOLIA"
            title="Synchronize the rental offer"
            copy="The owner, tariff, and active state are copied into UsagePaymentRegistry. The machine remains unrentable until these values match."
            network="Ethereum Sepolia · 11155111"
            items={[
              ['Beneficiary', props.session.account],
              ['Price / second', props.session.draft.tariff],
              ['Machine active', String(props.session.draft.active)],
              ['Registry owner', props.registryOwnerAddress ?? 'Checking'],
            ]}
            busy={props.busy === 'sepolia'}
            disabled={!props.registryOwner}
            button={
              props.registryOwner
                ? 'Publish synchronized offer'
                : 'Registry owner wallet required'
            }
            onClick={props.onSynchronize}
          />
        ) : props.session ? (
          <div className="onboarding-complete">
            <span>
              <Check />
            </span>
            <p className="eyebrow">ONBOARDING COMPLETE</p>
            <h2>{props.session.draft.name} is synchronized.</h2>
            <p>
              Both confirmations are persisted. The marketplace will present
              this machine as rentable only after live owner, tariff, active
              state, and metadata checks agree.
            </p>
            <div>
              <a
                href={`${props.config.creditcoinExplorerUrl}/tx/${props.session.creditcoinTransactionHash}`}
                target="_blank"
                rel="noreferrer"
              >
                CC3 registration <ExternalLink size={12} />
              </a>
              <a
                href={`${props.config.sepoliaExplorerUrl}/tx/${props.session.sepoliaTransactionHash}`}
                target="_blank"
                rel="noreferrer"
              >
                Sepolia offer <ExternalLink size={12} />
              </a>
            </div>
            <button type="button" onClick={props.onReset}>
              Onboard another machine <Plus size={14} />
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function TransactionStep({
  eyebrow,
  title,
  copy,
  network,
  items,
  busy,
  disabled,
  button,
  onClick,
}: {
  eyebrow: string;
  title: string;
  copy: string;
  network: string;
  items: string[][];
  busy: boolean;
  disabled?: boolean;
  button: string;
  onClick: () => void;
}) {
  return (
    <div className="transaction-step">
      <div className="operator-section-head">
        <div>
          <span>{eyebrow}</span>
          <h2>{title}</h2>
        </div>
        <SlidersHorizontal />
      </div>
      <p className="wizard-copy">{copy}</p>
      <div className="network-transition">
        <RefreshCw />
        <span>
          <small>WALLET NETWORK</small>
          <strong>{network}</strong>
        </span>
      </div>
      <dl>
        {items.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd title={value}>{compactHash(value ?? 'Pending', 18, 12)}</dd>
          </div>
        ))}
      </dl>
      <button
        className="wizard-primary"
        type="button"
        disabled={disabled || busy}
        onClick={onClick}
      >
        {busy ? <LoaderCircle className="spinner" /> : <Wallet />}
        {button}
        <ArrowRight />
      </button>
      {disabled && (
        <small className="wizard-validation">
          This contract is owner-gated. Connect the displayed registry-owner
          account to continue.
        </small>
      )}
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  mono,
  wide,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  mono?: boolean;
  wide?: boolean;
}) {
  return (
    <label className={wide ? 'wide' : ''}>
      <span>{label}</span>
      <input
        className={mono ? 'mono' : ''}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
      />
    </label>
  );
}

function MachineEditor({
  machine,
  account,
  registryOwner,
  client,
  walletProvider,
  busy,
  onClose,
  execute,
}: {
  machine: MarketplaceMachine;
  account: string;
  registryOwner: boolean;
  client: OperatorClient;
  walletProvider: NonNullable<ReturnType<typeof useRuntime>['walletProvider']>;
  busy?: string;
  onClose: () => void;
  execute: (label: string, operation: () => Promise<void>) => Promise<void>;
}) {
  const [controller, setController] = useState(machine.controller);
  const [tariff, setTariff] = useState(machine.tariff.toString());
  const [active, setActive] = useState(machine.active);
  const [metadataDraft, setMetadataDraft] = useState<MachineDraft>({
    ...emptyMachineDraft,
    label: machine.machineId,
    name: machine.metadata?.name ?? '',
    description: machine.metadata?.description ?? '',
    image: machine.metadata?.image ?? 'industrial-machine',
    category: machine.metadata?.category ?? '',
    city: machine.metadata?.location.city ?? '',
    country: machine.metadata?.location.country ?? '',
    site: machine.metadata?.location.site ?? '',
    capabilities: machine.metadata?.capabilities.join(', ') ?? '',
    safetyRequirements: machine.metadata?.safetyRequirements.join(', ') ?? '',
    controller,
    tariff,
    active,
  });
  const run = (label: string, operation: () => Promise<unknown>) =>
    void execute(label, async () => {
      await operation();
    });
  return (
    <section className="machine-editor">
      <div className="operator-section-head">
        <div>
          <span>OWNER MUTATIONS / CREDITCOIN</span>
          <h2>
            Manage {machine.metadata?.name ?? compactHash(machine.machineId)}
          </h2>
        </div>
        <button type="button" onClick={onClose}>
          Close
        </button>
      </div>
      <div className="machine-editor-grid">
        <article>
          <h3>Controller</h3>
          <p>Address authorized to operate the physical device integration.</p>
          <Field
            label="Controller address"
            value={controller}
            onChange={setController}
            mono
          />
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() =>
              run('update-controller', () =>
                client.updateController(
                  machine.machineId,
                  controller,
                  account,
                  walletProvider,
                ),
              )
            }
          >
            Update controller
          </button>
        </article>
        <article>
          <h3>Tariff</h3>
          <p>
            Update CC3 first; field-level drift will remain visible until the
            Sepolia repair is confirmed.
          </p>
          <Field
            label="Token units / second"
            value={tariff}
            onChange={setTariff}
            mono
          />
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() =>
              run('update-tariff', () =>
                client.updateTariff(
                  machine.machineId,
                  tariff,
                  account,
                  walletProvider,
                ),
              )
            }
          >
            Update CC3 tariff
          </button>
        </article>
        <article>
          <h3>Availability</h3>
          <p>
            Creditcoin is authoritative. Repair the Sepolia offer after this
            confirmation.
          </p>
          <label className="operator-toggle">
            <input
              type="checkbox"
              checked={active}
              onChange={(event) => setActive(event.target.checked)}
            />
            <span>{active ? 'Active' : 'Paused'}</span>
          </label>
          <button
            type="button"
            disabled={Boolean(busy)}
            onClick={() =>
              run('update-active', () =>
                client.setCreditcoinActive(
                  machine.machineId,
                  active,
                  account,
                  walletProvider,
                ),
              )
            }
          >
            Update CC3 status
          </button>
        </article>
        <article className="metadata-editor">
          <h3>Metadata</h3>
          <p>
            Upload a new immutable document, then commit its exact URI digest on
            Creditcoin.
          </p>
          <div className="operator-form-grid">
            <Field
              label="Name"
              value={metadataDraft.name}
              onChange={(value) =>
                setMetadataDraft((item) => ({ ...item, name: value }))
              }
            />
            <Field
              label="Category"
              value={metadataDraft.category}
              onChange={(value) =>
                setMetadataDraft((item) => ({ ...item, category: value }))
              }
            />
            <Field
              label="City"
              value={metadataDraft.city}
              onChange={(value) =>
                setMetadataDraft((item) => ({ ...item, city: value }))
              }
            />
            <Field
              label="Country"
              value={metadataDraft.country}
              onChange={(value) =>
                setMetadataDraft((item) => ({ ...item, country: value }))
              }
            />
            <Field
              label="Site / bay"
              value={metadataDraft.site}
              onChange={(value) =>
                setMetadataDraft((item) => ({ ...item, site: value }))
              }
            />
            <label className="wide">
              <span>Description</span>
              <textarea
                value={metadataDraft.description}
                onChange={(event) =>
                  setMetadataDraft((item) => ({
                    ...item,
                    description: event.target.value,
                  }))
                }
              />
            </label>
          </div>
          <button
            type="button"
            disabled={Boolean(
              busy ||
              validateMachineDraft({
                ...metadataDraft,
                controller,
                tariff,
                active,
              }).length,
            )}
            onClick={() =>
              run('update-metadata', async () => {
                const uploaded = await client.uploadMetadata(
                  { ...metadataDraft, controller, tariff, active },
                  account,
                );
                await client.updateMetadata(
                  machine.machineId,
                  uploaded.commitment,
                  account,
                  walletProvider,
                );
              })
            }
          >
            Upload and commit metadata
          </button>
        </article>
      </div>
      {!registryOwner && (
        <p className="machine-editor-note">
          After a tariff or availability change, the Sepolia registry owner must
          use “Repair offer” in inventory to restore rentability.
        </p>
      )}
    </section>
  );
}

function statusLabel(machine: MarketplaceMachine) {
  return {
    available: 'Rentable on both chains',
    inactive: 'Paused',
    unsynchronized: 'Configuration drift',
    'metadata-invalid': 'Metadata unresolved',
  }[machine.status];
}
