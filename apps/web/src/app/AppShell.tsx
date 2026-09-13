import {
  Activity,
  Blocks,
  Compass,
  ExternalLink,
  HeartPulse,
  Menu,
  RadioTower,
  ShieldCheck,
  UserRound,
  Wallet,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigation } from 'react-router';
import { compactHash } from '../product.js';
import { BrandMark } from '../components/BrandMark.js';
import { WalletDialog } from '../components/WalletDialog.js';
import { useRuntime } from './AppProviders.js';

const navigation = [
  { to: '/explore', label: 'Explore', icon: Compass },
  { to: '/activity', label: 'My rentals', icon: Activity },
  { to: '/proofs/search', label: 'Proof explorer', icon: ShieldCheck },
  { to: '/operator', label: 'Operator', icon: Blocks },
  { to: '/diagnostics', label: 'System', icon: HeartPulse },
];

export function AppShell() {
  const [menuOpen, setMenuOpen] = useState(false);
  const navigationState = useNavigation();
  const {
    account,
    connecting,
    openWallet,
    correctNetwork,
    chainId,
    switchToSepolia,
    walletError,
    configurationError,
    clearWalletError,
  } = useRuntime();

  return (
    <div className="app-shell">
      <div className="ambient ambient-one" />
      <div className="ambient ambient-two" />
      <header className="topbar">
        <Link className="brand" to="/" aria-label="ProofKey home">
          <BrandMark />
          <span>ProofKey</span>
        </Link>

        <nav
          className={menuOpen ? 'desktop-nav open' : 'desktop-nav'}
          aria-label="Primary"
        >
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink key={to} to={to} onClick={() => setMenuOpen(false)}>
              <Icon size={16} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="topbar-actions">
          <button
            className={correctNetwork ? 'chain-pill online' : 'chain-pill'}
            type="button"
            onClick={() =>
              account && !correctNetwork ? void switchToSepolia() : openWallet()
            }
          >
            <RadioTower size={14} />
            <span>
              {correctNetwork
                ? 'Sepolia connected'
                : account
                  ? `Switch chain ${chainId ?? ''}`
                  : 'Sepolia → Creditcoin'}
            </span>
          </button>
          <button
            className={account ? 'wallet-control connected' : 'wallet-control'}
            type="button"
            onClick={openWallet}
          >
            {account ? <UserRound size={16} /> : <Wallet size={16} />}
            <span>
              {connecting
                ? 'Connecting…'
                : account
                  ? compactHash(account, 6, 4)
                  : 'Connect wallet'}
            </span>
          </button>
          <button
            className="menu-button"
            type="button"
            aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((value) => !value)}
          >
            {menuOpen ? <X /> : <Menu />}
          </button>
        </div>
      </header>

      {navigationState.state !== 'idle' && <div className="route-progress" />}
      {(walletError || configurationError) && (
        <div className="global-alert" role="alert">
          <div>
            <strong>
              {walletError
                ? 'Wallet needs attention'
                : 'Network configuration incomplete'}
            </strong>
            <span>{walletError ?? configurationError}</span>
          </div>
          {walletError && (
            <button type="button" onClick={clearWalletError}>
              Dismiss
            </button>
          )}
        </div>
      )}

      <main className="app-main">
        <Outlet />
      </main>

      <WalletDialog />

      <footer className="site-footer">
        <div>
          <span className="brand compact">
            <BrandMark />
            ProofKey
          </span>
          <p>Proof-backed access for machines that work in the real world.</p>
        </div>
        <div className="footer-status">
          <Link to="/diagnostics">System status</Link>
          <span>
            <span className="live-dot" /> CC3 testnet
          </span>
          <a
            href="https://creditcoin-testnet.blockscout.com"
            target="_blank"
            rel="noreferrer"
          >
            Explorer <ExternalLink size={13} />
          </a>
        </div>
      </footer>
    </div>
  );
}
