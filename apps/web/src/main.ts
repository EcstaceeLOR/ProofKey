import { formatUnits } from 'ethers';
import './styles.css';
import {
  PaymentClient,
  loadAppConfig,
  type AppConfig,
  type MachineOffer,
  type PaymentUpdate,
} from './contracts.js';
import {
  formatDuration,
  progressFromJob,
  shortenAddress,
  totalForDuration,
  type JourneyStep,
  type RelayJob,
} from './flow.js';
import { ProofWorkerClient } from './worker.js';

const durationButtons = [
  ...document.querySelectorAll<HTMLButtonElement>('[data-duration]'),
];
const walletButton = element<HTMLButtonElement>('#wallet-button');
const primaryAction = element<HTMLButtonElement>('#primary-action');
const primaryLabel = element<HTMLElement>('#primary-label');
const actionHelp = element<HTMLElement>('#action-help');
const errorBanner = element<HTMLElement>('#error-banner');
const availability = element<HTMLElement>('#availability');
const tariff = element<HTMLElement>('#tariff');
const tokenSymbol = element<HTMLElement>('#token-symbol');
const totalPrice = element<HTMLElement>('#total-price');
const durationLabel = element<HTMLElement>('#duration-label');
const machineName = element<HTMLElement>('#machine-name');
const machineLocation = element<HTMLElement>('#machine-location');
const machineIdElement = element<HTMLElement>('#machine-id');
const journeyStatus = element<HTMLElement>('#journey-status');
const receiptPanel = element<HTMLElement>('#receipt-panel');
const receiptTitle = element<HTMLElement>('#receipt-title');
const receiptSubtitle = element<HTMLElement>('#receipt-subtitle');
const sourceLink = element<HTMLAnchorElement>('#source-link');
const creditcoinLink = element<HTMLAnchorElement>('#creditcoin-link');
const accessExpiry = element<HTMLElement>('#access-expiry');
const openDevice = element<HTMLAnchorElement>('#open-device');
const progressItems = [
  ...document.querySelectorAll<HTMLElement>('[data-step]'),
];

let config: AppConfig;
let paymentClient: PaymentClient;
let workerClient: ProofWorkerClient;
let offer: MachineOffer | undefined;
let account: string | undefined;
let correctNetwork = false;
let busy = false;
let verified = false;
let accessExpired = false;
let selectedDuration = 14_400;
let storageKey = 'proofkey:last-source-transaction';
let sourceTransactionHash: string | undefined;
let sourceExpiresAt: bigint | undefined;

initialize().catch(showError);

async function initialize(): Promise<void> {
  config = loadAppConfig(import.meta.env);
  paymentClient = new PaymentClient(config);
  workerClient = new ProofWorkerClient(config.workerUrl);
  storageKey = `proofkey:${config.registryAddress.toLowerCase()}:${config.machineId}:source-transaction`;
  sourceTransactionHash = localStorage.getItem(storageKey) ?? undefined;
  machineName.textContent = config.machineName;
  machineLocation.textContent = config.machineLocation;
  machineIdElement.textContent = config.machineId;
  machineIdElement.title = config.machineId;
  openDevice.href = config.deviceUrl;

  bindEvents();
  offer = await paymentClient.loadOffer();
  renderOffer();
  renderAction();
  if (sourceTransactionHash) void resumeRelay(sourceTransactionHash);
}

function bindEvents(): void {
  walletButton.addEventListener('click', () => void connectWallet());
  primaryAction.addEventListener('click', () => void handlePrimaryAction());
  for (const button of durationButtons) {
    button.addEventListener('click', () => {
      if (busy) return;
      selectedDuration = Number(button.dataset.duration);
      for (const option of durationButtons) {
        const selected = option === button;
        option.classList.toggle('selected', selected);
        option.setAttribute('aria-checked', String(selected));
      }
      renderPrice();
    });
  }
  window.ethereum?.on?.('chainChanged', () => void refreshWalletNetwork());
  window.ethereum?.on?.('accountsChanged', (accounts) => {
    const next =
      Array.isArray(accounts) && typeof accounts[0] === 'string'
        ? accounts[0]
        : undefined;
    account = next;
    correctNetwork = false;
    walletButton.textContent = account
      ? shortenAddress(account)
      : 'Connect wallet';
    renderAction();
  });
}

async function connectWallet(): Promise<void> {
  clearError();
  try {
    const connection = await paymentClient.connect();
    account = connection.account;
    correctNetwork = connection.correctNetwork;
    walletButton.textContent = shortenAddress(account);
    renderAction();
  } catch (error) {
    showError(error);
  }
}

async function refreshWalletNetwork(): Promise<void> {
  correctNetwork = await paymentClient.isSepolia();
  renderAction();
}

async function handlePrimaryAction(): Promise<void> {
  if (busy || verified) return;
  clearError();
  if (!account) return connectWallet();
  if (!correctNetwork) {
    try {
      await paymentClient.switchToSepolia();
      correctNetwork = true;
      renderAction();
    } catch (error) {
      showError(error);
    }
    return;
  }
  if (sourceTransactionHash) return resumeRelay(sourceTransactionHash);
  if (!offer) return;

  busy = true;
  renderAction();
  try {
    const payment = await paymentClient.payForUsage(
      offer,
      selectedDuration,
      renderPaymentUpdate,
    );
    sourceTransactionHash = payment.transactionHash;
    sourceExpiresAt = payment.expiresAt;
    localStorage.setItem(storageKey, payment.transactionHash);
    showSourceReceipt(payment.transactionHash, payment.expiresAt);
    await workerClient.enqueue(payment.transactionHash);
    await followRelay(payment.transactionHash);
  } catch (error) {
    showError(error);
  } finally {
    busy = false;
    renderAction();
  }
}

async function resumeRelay(transactionHash: string): Promise<void> {
  if (busy || verified) return;
  busy = true;
  clearError();
  showSourceReceipt(transactionHash, sourceExpiresAt);
  try {
    await workerClient.enqueue(transactionHash);
    await followRelay(transactionHash);
  } catch (error) {
    showError(error);
  } finally {
    busy = false;
    renderAction();
  }
}

async function followRelay(transactionHash: string): Promise<void> {
  const finalJob = await workerClient.waitForCompletion(
    transactionHash,
    renderRelayJob,
  );
  renderRelayJob(finalJob);
}

function renderPaymentUpdate(update: PaymentUpdate): void {
  clearProgress();
  setStep('payment', 'active');
  if (update.stage === 'approving') {
    journeyStatus.textContent = update.transactionHash
      ? 'Token approval submitted'
      : 'Confirm token approval in your wallet';
    primaryLabel.textContent = update.transactionHash
      ? 'Confirming approval…'
      : 'Approve token in wallet';
  } else if (update.stage === 'paying') {
    journeyStatus.textContent = 'Confirm the usage payment in your wallet';
    primaryLabel.textContent = 'Confirm payment in wallet';
  } else {
    sourceTransactionHash = update.transactionHash;
    localStorage.setItem(storageKey, update.transactionHash);
    journeyStatus.textContent = 'Payment submitted · waiting for Sepolia';
    primaryLabel.textContent = 'Confirming on Sepolia…';
    showSourceReceipt(update.transactionHash, sourceExpiresAt);
  }
}

function renderRelayJob(job: RelayJob): void {
  const progress = progressFromJob(job);
  clearProgress();
  for (const step of progress.completed) setStep(step, 'complete');
  if (!progress.completed.includes(progress.active))
    setStep(progress.active, 'active');
  journeyStatus.textContent = progress.label;
  primaryLabel.textContent = progress.label;
  if (job.accessExpiresAt) sourceExpiresAt = BigInt(job.accessExpiresAt);
  showSourceReceipt(job.sourceTransactionHash, sourceExpiresAt);

  if (!progress.verified) return;
  verified = true;
  receiptPanel.dataset.verified = 'true';
  const expired =
    sourceExpiresAt !== undefined &&
    sourceExpiresAt <= BigInt(Math.floor(Date.now() / 1_000));
  accessExpired = expired;
  if (expired) {
    journeyStatus.textContent = 'Proof verified · access window expired';
    receiptTitle.textContent = 'Proof verified · access expired';
    receiptSubtitle.textContent =
      'Creditcoin verified this payment, but its usage window has ended.';
    primaryLabel.textContent = 'Access window expired';
  } else {
    receiptTitle.textContent = 'Access verified';
    receiptSubtitle.textContent =
      'Creditcoin accepted the proof. Your machine is ready.';
    primaryLabel.textContent = 'Machine access unlocked';
  }
  if (job.creditcoinTransactionHash) {
    creditcoinLink.href = `${config.creditcoinExplorerUrl}/tx/${job.creditcoinTransactionHash}`;
    creditcoinLink.hidden = false;
  }
  localStorage.removeItem(storageKey);
}

function showSourceReceipt(transactionHash: string, expiresAt?: bigint): void {
  receiptPanel.hidden = false;
  sourceLink.href = `${config.sepoliaExplorerUrl}/tx/${transactionHash}`;
  if (!verified) {
    receiptPanel.dataset.verified = 'false';
    receiptTitle.textContent = 'Payment received';
    receiptSubtitle.textContent =
      'Cross-chain verification is still in progress.';
  }
  accessExpiry.textContent = expiresAt
    ? formatExpiry(expiresAt)
    : 'Calculated after receipt validation';
}

function renderOffer(): void {
  if (!offer) return;
  availability.textContent = offer.active
    ? 'AVAILABLE NOW'
    : 'CURRENTLY UNAVAILABLE';
  availability.parentElement?.classList.toggle('unavailable', !offer.active);
  tokenSymbol.textContent = `${offer.tokenSymbol} / minute`;
  tariff.textContent = formatAmount(offer.pricePerSecond * 60n, offer);
  renderPrice();
}

function renderPrice(): void {
  durationLabel.textContent = formatDuration(selectedDuration);
  totalPrice.textContent = offer
    ? `${formatAmount(totalForDuration(offer.pricePerSecond, selectedDuration), offer)} ${offer.tokenSymbol}`
    : '—';
}

function renderAction(): void {
  primaryAction.disabled = busy || verified || !offer || !offer.active;
  durationButtons.forEach((button) => (button.disabled = busy || verified));
  if (verified) {
    primaryLabel.textContent = accessExpired
      ? 'Access window expired'
      : 'Machine access unlocked';
    actionHelp.textContent = accessExpired
      ? 'This proof remains verified, but it no longer grants live machine access.'
      : 'Your proof-backed access is active on Creditcoin.';
  } else if (busy) {
    actionHelp.textContent =
      'Keep this tab open. Proof generation can take several minutes.';
  } else if (sourceTransactionHash) {
    primaryLabel.textContent = 'Resume proof verification';
    actionHelp.textContent =
      'Your payment is safe. Continue the existing relay job.';
  } else if (!account) {
    primaryLabel.textContent = 'Connect wallet to continue';
    actionHelp.textContent =
      'New here? Connect a wallet with Sepolia ETH and the payment token.';
  } else if (!correctNetwork) {
    primaryLabel.textContent = 'Switch to Ethereum Sepolia';
    actionHelp.textContent =
      'ProofKey will request the correct test network in your wallet.';
  } else {
    primaryLabel.textContent = 'Pay & start verification';
    actionHelp.textContent =
      'You’ll approve the token if needed, then confirm one payment.';
  }
}

function clearProgress(): void {
  for (const item of progressItems) item.classList.remove('active', 'complete');
}

function setStep(step: JourneyStep, state: 'active' | 'complete'): void {
  progressItems
    .find((item) => item.dataset.step === step)
    ?.classList.add(state);
}

function formatAmount(amount: bigint, machineOffer: MachineOffer): string {
  const formatted = formatUnits(amount, machineOffer.tokenDecimals);
  const [whole, fraction = ''] = formatted.split('.');
  const compactFraction = fraction.slice(0, 4).replace(/0+$/, '');
  return compactFraction ? `${whole}.${compactFraction}` : (whole ?? '0');
}

function formatExpiry(expiresAt: bigint): string {
  const milliseconds = Number(expiresAt) * 1_000;
  return Number.isSafeInteger(milliseconds)
    ? new Date(milliseconds).toLocaleString([], {
        dateStyle: 'medium',
        timeStyle: 'short',
      })
    : `Unix ${expiresAt}`;
}

function showError(error: unknown): void {
  const candidate = error as {
    shortMessage?: string;
    message?: string;
    code?: string | number;
  };
  const message =
    candidate.code === 4001 || candidate.code === 'ACTION_REJECTED'
      ? 'Wallet request cancelled. Nothing was charged.'
      : (candidate.shortMessage ?? candidate.message ?? String(error));
  errorBanner.textContent = message;
  errorBanner.hidden = false;
  journeyStatus.textContent = 'Action needed';
  busy = false;
  renderAction();
}

function clearError(): void {
  errorBanner.hidden = true;
  errorBanner.textContent = '';
}

function element<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing UI element ${selector}.`);
  return found;
}
