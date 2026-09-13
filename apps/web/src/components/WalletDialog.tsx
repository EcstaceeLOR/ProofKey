import {
  ArrowRight,
  Check,
  Copy,
  ExternalLink,
  LogOut,
  MonitorSmartphone,
  RadioTower,
  RefreshCw,
  ShieldCheck,
  Smartphone,
  Wallet,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useBalance, useReadContract } from 'wagmi';
import { sepolia } from 'wagmi/chains';
import { erc20Abi, formatUnits, type Address } from 'viem';
import { useMachineOffer, useRuntime } from '../app/AppProviders.js';
import { compactHash } from '../product.js';
import { formatWalletBalance } from '../wallet/state.js';

export function WalletDialog() {
  const runtime = useRuntime();
  const offer = useMachineOffer();
  const [copied, setCopied] = useState(false);
  const address = runtime.account as Address | undefined;
  const tokenAddress = offer.data?.tokenAddress as Address | undefined;
  const ethBalance = useBalance({
    address,
    chainId: sepolia.id,
    query: { enabled: Boolean(address) },
  });
  const tokenBalance = useReadContract({
    address: tokenAddress,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: sepolia.id,
    query: { enabled: Boolean(address && tokenAddress) },
  });
  const connectors = useMemo(
    () =>
      runtime.connectors.filter(
        (connector, index, all) =>
          connector.type !== 'walletConnect' &&
          all.findIndex(
            (candidate) =>
              candidate.name === connector.name &&
              candidate.type === connector.type,
          ) === index,
      ),
    [runtime.connectors],
  );

  useEffect(() => {
    if (!runtime.walletOpen) return;
    const previousOverflow = document.body.style.overflow;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') runtime.closeWallet();
    };
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [runtime.walletOpen, runtime.closeWallet]);

  if (!runtime.walletOpen) return null;

  async function copyAddress() {
    if (!runtime.account) return;
    await navigator.clipboard.writeText(runtime.account);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  }

  return (
    <div
      className="wallet-overlay"
      role="presentation"
      onMouseDown={runtime.closeWallet}
    >
      <section
        className="wallet-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="wallet-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="wallet-dialog-head">
          <div>
            <p className="eyebrow">PROOFKEY WALLET</p>
            <h2 id="wallet-dialog-title">
              {runtime.account ? 'Your connection' : 'Choose a wallet'}
            </h2>
          </div>
          <button
            type="button"
            aria-label="Close wallet dialog"
            onClick={runtime.closeWallet}
            autoFocus
          >
            <X size={20} />
          </button>
        </header>

        {runtime.account ? (
          <div className="wallet-account-view">
            <div className="wallet-identity">
              <div className="wallet-identicon" aria-hidden="true">
                {runtime.account.slice(2, 4).toUpperCase()}
              </div>
              <div>
                <span>{runtime.connectorName ?? 'Connected wallet'}</span>
                <strong>{compactHash(runtime.account, 10, 8)}</strong>
              </div>
              <button
                type="button"
                onClick={() => void copyAddress()}
                aria-label="Copy wallet address"
              >
                {copied ? <Check size={16} /> : <Copy size={16} />}
              </button>
            </div>

            <div
              className={
                runtime.correctNetwork
                  ? 'wallet-network good'
                  : 'wallet-network warning'
              }
            >
              <div>
                <RadioTower size={18} />
                <span>
                  <strong>
                    {runtime.correctNetwork
                      ? 'Ethereum Sepolia'
                      : `Unsupported chain ${runtime.chainId ?? ''}`}
                  </strong>
                  <small>
                    {runtime.correctNetwork
                      ? 'Ready to pay and prove'
                      : 'ProofKey payments require chain ID 11155111'}
                  </small>
                </span>
              </div>
              {!runtime.correctNetwork && (
                <button
                  type="button"
                  onClick={() => void runtime.switchToSepolia()}
                >
                  Switch network <ArrowRight size={14} />
                </button>
              )}
            </div>

            <div className="wallet-balances">
              <div>
                <span>NETWORK GAS</span>
                <strong>
                  {ethBalance.isLoading
                    ? 'Loading…'
                    : formatWalletBalance(
                        ethBalance.data
                          ? formatUnits(
                              ethBalance.data.value,
                              ethBalance.data.decimals,
                            )
                          : undefined,
                        ethBalance.data?.symbol,
                      )}
                </strong>
                <small>Sepolia ETH</small>
              </div>
              <div>
                <span>PAYMENT BALANCE</span>
                <strong>
                  {tokenBalance.isLoading
                    ? 'Loading…'
                    : formatWalletBalance(
                        tokenBalance.data !== undefined && offer.data
                          ? formatUnits(
                              tokenBalance.data,
                              offer.data.tokenDecimals,
                            )
                          : undefined,
                        offer.data?.tokenSymbol,
                      )}
                </strong>
                <small>
                  {offer.data?.tokenSymbol ?? 'Configured usage token'}
                </small>
              </div>
            </div>

            <div className="wallet-account-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => void runtime.disconnectWallet()}
              >
                <RefreshCw size={15} /> Change wallet or account
              </button>
              <button
                className="wallet-disconnect"
                type="button"
                onClick={() =>
                  void runtime.disconnectWallet().then(runtime.closeWallet)
                }
              >
                <LogOut size={15} /> Disconnect
              </button>
            </div>
          </div>
        ) : (
          <div className="wallet-picker">
            <p className="wallet-picker-copy">
              Connect to rent machines and inspect your access. ProofKey never
              requests a signature on page load.
            </p>
            <div className="wallet-options">
              {connectors.map((connector) => (
                <button
                  key={connector.uid}
                  type="button"
                  disabled={runtime.connecting}
                  onClick={() => void runtime.connectWallet(connector)}
                >
                  <span className="wallet-option-icon">
                    {connector.icon ? (
                      <img src={connector.icon} alt="" />
                    ) : connector.type === 'walletConnect' ? (
                      <Smartphone size={21} />
                    ) : connector.type === 'coinbaseWallet' ? (
                      <Wallet size={21} />
                    ) : (
                      <MonitorSmartphone size={21} />
                    )}
                  </span>
                  <span>
                    <strong>{connector.name}</strong>
                    <small>
                      {connector.type === 'walletConnect'
                        ? 'Scan with a mobile wallet'
                        : connector.type === 'coinbaseWallet'
                          ? 'Extension or Coinbase app'
                          : 'Detected in this browser'}
                    </small>
                  </span>
                  {runtime.connecting ? (
                    <RefreshCw className="spin" size={16} />
                  ) : (
                    <ArrowRight size={16} />
                  )}
                </button>
              ))}
              {runtime.walletConnectConfigured ? (
                <button
                  type="button"
                  disabled={runtime.connecting}
                  onClick={() => void runtime.openMobileWallet()}
                >
                  <span className="wallet-option-icon">
                    <Smartphone size={21} />
                  </span>
                  <span>
                    <strong>WalletConnect mobile</strong>
                    <small>Scan with any Reown-compatible mobile wallet</small>
                  </span>
                  <ArrowRight size={16} />
                </button>
              ) : (
                <div className="wallet-option-unavailable">
                  <span className="wallet-option-icon">
                    <Smartphone size={21} />
                  </span>
                  <span>
                    <strong>WalletConnect mobile</strong>
                    <small>
                      Add the Reown project ID in deployment configuration
                    </small>
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {runtime.walletError && (
          <div className="wallet-dialog-error" role="alert">
            <ShieldCheck size={17} />
            <span>{runtime.walletError}</span>
            <button type="button" onClick={runtime.clearWalletError}>
              Dismiss
            </button>
          </div>
        )}
        <footer className="wallet-dialog-foot">
          <span>
            <ShieldCheck size={13} /> Non-custodial connection
          </span>
          <a
            href="https://sepolia.etherscan.io"
            target="_blank"
            rel="noreferrer"
          >
            Sepolia explorer <ExternalLink size={12} />
          </a>
        </footer>
      </section>
    </div>
  );
}
