import {
  ArrowRight,
  Check,
  Clock3,
  MapPin,
  ShieldCheck,
  Wrench,
} from 'lucide-react';
import { formatUnits } from 'ethers';
import { Link } from 'react-router';
import type { MachineOffer } from '../contracts.js';
import type { MarketplaceMachine } from '../marketplace.js';
import { compactHash, machinePath, rentPath } from '../product.js';

export function PageHeading({
  eyebrow,
  title,
  copy,
  action,
}: {
  eyebrow: string;
  title: string;
  copy: string;
  action?: React.ReactNode;
}) {
  return (
    <header className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="page-copy">{copy}</p>
      </div>
      {action && <div className="page-heading-action">{action}</div>}
    </header>
  );
}

export function MachineArtwork({
  compact = false,
  variant = 'excavator',
}: {
  compact?: boolean;
  variant?: string;
}) {
  const label =
    {
      excavator: 'PK / CONSTRUCTION',
      tractor: 'PK / AGRICULTURE',
      energy: 'PK / ENERGY',
      coldchain: 'PK / LOGISTICS',
      cnc: 'PK / MANUFACTURING',
    }[variant] ?? 'PK / INDUSTRIAL';
  return (
    <div
      className={compact ? 'machine-visual compact' : 'machine-visual'}
      data-machine-kind={variant}
      aria-hidden="true"
    >
      <div className="visual-grid" />
      <div className="visual-orbit" />
      <svg viewBox="0 0 720 360">
        <defs>
          <linearGradient id="machine-body" x1="0" x2="1">
            <stop offset="0" stopColor="#efff78" />
            <stop offset="1" stopColor="#a8cf3e" />
          </linearGradient>
        </defs>
        <MachineGlyph variant={variant} />
      </svg>
      <span className="visual-label">{label}</span>
    </div>
  );
}

function MachineGlyph({ variant }: { variant: string }) {
  if (variant === 'tractor')
    return (
      <>
        <path d="M112 292h495l46 20H74z" fill="#020806" opacity=".35" />
        <circle
          cx="220"
          cy="260"
          r="70"
          fill="#07110c"
          stroke="#587064"
          strokeWidth="18"
        />
        <circle
          cx="535"
          cy="270"
          r="48"
          fill="#07110c"
          stroke="#587064"
          strokeWidth="14"
        />
        <path d="M202 210h170l35 60H281z" fill="url(#machine-body)" />
        <path d="M325 92h125l45 133H302z" fill="#d8ee55" />
        <path d="M350 111h76l28 83H327z" fill="#173126" />
        <path d="M437 196h136l55 70H404z" fill="#bddf47" />
        <rect x="548" y="148" width="18" height="74" rx="8" fill="#16261e" />
      </>
    );
  if (variant === 'energy')
    return (
      <>
        <path d="M120 290h500l42 21H83z" fill="#020806" opacity=".35" />
        <circle
          cx="220"
          cy="276"
          r="36"
          fill="#07110c"
          stroke="#587064"
          strokeWidth="12"
        />
        <circle
          cx="510"
          cy="276"
          r="36"
          fill="#07110c"
          stroke="#587064"
          strokeWidth="12"
        />
        <rect x="170" y="180" width="390" height="91" rx="19" fill="#d8ee55" />
        <rect x="205" y="202" width="78" height="45" rx="8" fill="#173126" />
        <path d="M180 168l88-103h300l-66 103z" fill="#426f61" />
        <path
          d="M277 65l-85 103M373 65l-54 103M469 65l-23 103"
          stroke="#b9d0c8"
          strokeWidth="7"
        />
        <path d="M245 116h290" stroke="#b9d0c8" strokeWidth="7" />
        <path d="M560 226h67l32 22-99 8z" fill="#bddf47" />
      </>
    );
  if (variant === 'coldchain')
    return (
      <>
        <path d="M98 292h544l43 20H63z" fill="#020806" opacity=".35" />
        <rect
          x="112"
          y="105"
          width="445"
          height="164"
          rx="20"
          fill="url(#machine-body)"
        />
        <path d="M557 164h74l45 62v43H557z" fill="#bddf47" />
        <path d="M579 181h39l27 38h-66z" fill="#173126" />
        <path
          d="M160 140h350M160 177h350"
          stroke="#8da83c"
          strokeWidth="7"
          opacity=".7"
        />
        <circle
          cx="217"
          cy="273"
          r="40"
          fill="#07110c"
          stroke="#587064"
          strokeWidth="13"
        />
        <circle
          cx="587"
          cy="273"
          r="40"
          fill="#07110c"
          stroke="#587064"
          strokeWidth="13"
        />
        <path
          d="M328 127v119m-20-23 40-72m-40 0 40 72"
          stroke="#173126"
          strokeWidth="10"
          strokeLinecap="round"
        />
      </>
    );
  if (variant === 'cnc')
    return (
      <>
        <path d="M127 294h480l49 18H88z" fill="#020806" opacity=".35" />
        <rect
          x="154"
          y="72"
          width="412"
          height="215"
          rx="24"
          fill="url(#machine-body)"
        />
        <rect x="187" y="102" width="240" height="146" rx="15" fill="#10231a" />
        <path
          d="M307 116v52l-47 39m47-39 52 36"
          stroke="#d8ee55"
          strokeWidth="19"
          strokeLinecap="round"
        />
        <circle cx="307" cy="168" r="23" fill="#ff6847" />
        <rect x="453" y="112" width="80" height="20" rx="8" fill="#173126" />
        <rect x="453" y="147" width="80" height="13" rx="6" fill="#789187" />
        <rect x="453" y="174" width="80" height="13" rx="6" fill="#789187" />
        <rect x="453" y="215" width="38" height="30" rx="8" fill="#ff6847" />
      </>
    );
  return (
    <>
      <path d="M140 286h420l57 24H105z" fill="#020806" opacity=".35" />
      <rect x="164" y="231" width="344" height="70" rx="29" fill="#101c16" />
      <circle
        cx="232"
        cy="269"
        r="47"
        fill="#06100b"
        stroke="#50675b"
        strokeWidth="13"
      />
      <circle
        cx="438"
        cy="269"
        r="47"
        fill="#06100b"
        stroke="#50675b"
        strokeWidth="13"
      />
      <path d="M203 226l48-126h161l60 126z" fill="url(#machine-body)" />
      <path d="M275 111h119l34 87H244z" fill="#10231a" />
      <path d="M295 124h80l22 57H274z" fill="#7ba191" opacity=".7" />
      <rect x="178" y="200" width="299" height="53" rx="13" fill="#d8ee55" />
      <path d="M419 116l105-50 25 32-99 89z" fill="#d8ee55" />
      <path d="M519 63l31-15 86 140-35 19z" fill="#b9da45" />
      <path d="M598 186l76-37 20 54-87 27z" fill="#d8ee55" />
    </>
  );
}

export function MachineCard({
  machine,
  machineId,
  name: suppliedName,
  location: suppliedLocation,
  offer: suppliedOffer,
  loading,
}: {
  machine?: MarketplaceMachine;
  machineId?: string;
  name?: string;
  location?: string;
  offer?: MachineOffer;
  loading?: boolean;
}) {
  const available = machine
    ? machine.status === 'available'
    : Boolean(suppliedOffer?.active);
  const name = machine?.metadata?.name ?? suppliedName ?? 'Unverified machine';
  const location = machine?.metadata
    ? `${machine.metadata.location.city}, ${machine.metadata.location.country} · ${machine.metadata.location.site}`
    : (suppliedLocation ?? 'Metadata unavailable');
  const offer: MachineOffer | undefined = machine?.offer
    ? {
        beneficiary: machine.offer.beneficiary,
        pricePerSecond: machine.offer.pricePerSecond,
        active: available,
        tokenAddress: machine.tokenAddress,
        tokenDecimals: machine.tokenDecimals,
        tokenSymbol: machine.tokenSymbol,
      }
    : suppliedOffer;
  const statusLabel = loading
    ? 'Checking chain'
    : machine
      ? {
          available: 'Available now',
          inactive: 'Inactive',
          unsynchronized: 'Cross-chain mismatch',
          'metadata-invalid': 'Metadata rejected',
        }[machine.status]
      : available
        ? 'Available now'
        : 'Unavailable';
  const resolvedId = machine?.machineId ?? machineId ?? '';
  return (
    <article className={`catalog-card ${machine?.status ?? ''}`}>
      <MachineArtwork compact variant={machine?.metadata?.image} />
      <div className="catalog-card-body">
        <div className="card-topline">
          <span className={available ? 'status available' : 'status'}>
            <span /> {statusLabel}
          </span>
          <span className="chain-tag">CC3 VERIFIED</span>
        </div>
        <h2>{name}</h2>
        <p className="location">
          <MapPin size={14} /> {location}
        </p>
        <div className="machine-metrics">
          <div>
            <span>Rate</span>
            <strong>{offer ? `${formatRate(offer)} / min` : '—'}</strong>
          </div>
          <div>
            <span>Access</span>
            <strong>Proof-backed</strong>
          </div>
        </div>
        <div className="card-actions">
          <Link className="button secondary" to={machinePath(resolvedId)}>
            View machine
          </Link>
          {available ? (
            <Link className="button primary" to={rentPath(resolvedId)}>
              Rent now <ArrowRight size={16} />
            </Link>
          ) : (
            <span className="button primary disabled" aria-disabled="true">
              Unavailable
            </span>
          )}
        </div>
      </div>
    </article>
  );
}

export function DataState({
  kind,
  title,
  copy,
  action,
}: {
  kind: 'loading' | 'empty' | 'error' | 'offline';
  title: string;
  copy: string;
  action?: React.ReactNode;
}) {
  const Icon =
    kind === 'loading' ? Clock3 : kind === 'error' ? Wrench : ShieldCheck;
  return (
    <div
      className={`data-state ${kind}`}
      role={kind === 'error' ? 'alert' : undefined}
    >
      <span className="state-icon">
        <Icon size={22} />
      </span>
      <div>
        <strong>{title}</strong>
        <p>{copy}</p>
      </div>
      {action}
    </div>
  );
}

export function InvariantList({
  items,
}: {
  items: Array<{ label: string; value: string; ok: boolean }>;
}) {
  return (
    <div className="invariant-list">
      {items.map((item) => (
        <div key={item.label}>
          <span className={item.ok ? 'check ok' : 'check'}>
            <Check size={13} />
          </span>
          <span>{item.label}</span>
          <strong title={item.value}>{compactHash(item.value, 12, 8)}</strong>
        </div>
      ))}
    </div>
  );
}

export function formatRate(offer: MachineOffer): string {
  return `${formatUnits(offer.pricePerSecond * 60n, offer.tokenDecimals)} ${offer.tokenSymbol}`;
}
