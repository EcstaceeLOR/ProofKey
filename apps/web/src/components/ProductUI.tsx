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

export function MachineArtwork({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={compact ? 'machine-visual compact' : 'machine-visual'}
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
      </svg>
      <span className="visual-label">PK / INDUSTRIAL / 001</span>
    </div>
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
      <MachineArtwork compact />
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
