import './styles.css';
import {
  CreditcoinAuthorizationReader,
  loadDeviceConfig,
} from './creditcoin.js';
import {
  MachineController,
  type MachineState,
  type MachineView,
} from './state.js';

const shell = element<HTMLElement>('.shell');
const refreshButton = element<HTMLButtonElement>('#refresh');
const stateLabel = element<HTMLElement>('#state-label');
const stateWord = element<HTMLElement>('.state-word');
const stateTitle = element<HTMLElement>('#state-title');
const stateDescription = element<HTMLElement>('#state-description');
const machineId = element<HTMLElement>('#machine-id');
const beneficiary = element<HTMLElement>('#beneficiary');
const chainName = element<HTMLElement>('#chain-name');
const accessExpiry = element<HTMLElement>('#access-expiry');
const machineActive = element<HTMLElement>('#machine-active');
const checkedBlock = element<HTMLElement>('#checked-block');
const configurationError = element<HTMLElement>('#configuration-error');
const countdown = element<HTMLElement>('#countdown');

const copy: Record<MachineState, { title: string; description: string }> = {
  locked: {
    title: 'Awaiting verified access',
    description:
      'Creditcoin reports no active AccessPass for this beneficiary.',
  },
  unlocking: {
    title: 'Checking Creditcoin',
    description:
      'Reading the machine and authorization contracts. No local override is possible.',
  },
  unlocked: {
    title: 'Access verified',
    description:
      'Creditcoin confirms a live proof-backed AccessPass. The machine is available.',
  },
  expired: {
    title: 'Access window expired',
    description:
      'The on-chain credential reached its expiry. The machine has locked automatically.',
  },
};

let nextCheckAt = Date.now() + 4_000;

try {
  const config = loadDeviceConfig(import.meta.env);
  machineId.textContent = config.machineId;
  beneficiary.textContent = config.beneficiary;
  chainName.textContent = `Creditcoin CC3 Testnet · ${config.chainId}`;

  const controller = new MachineController(
    new CreditcoinAuthorizationReader(config),
    render,
  );

  const refresh = async (): Promise<void> => {
    refreshButton.disabled = true;
    await controller.refresh();
    refreshButton.disabled = false;
    nextCheckAt = Date.now() + 4_000;
  };

  refreshButton.addEventListener('click', () => void refresh());
  window.setInterval(() => {
    controller.tick();
    const seconds = Math.max(0, Math.ceil((nextCheckAt - Date.now()) / 1_000));
    countdown.textContent = `AUTO-CHECK IN ${seconds}S`;
  }, 250);
  window.setInterval(() => {
    if (!document.hidden) void refresh();
  }, 4_000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) void refresh();
  });
  void refresh();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  configurationError.hidden = false;
  configurationError.textContent = message;
  refreshButton.disabled = true;
  render({ state: 'locked', error: message });
}

function render(view: MachineView): void {
  const state = view.state;
  shell.dataset.state = state;
  const label = state.toUpperCase();
  stateLabel.textContent = label;
  stateWord.textContent = label;
  stateTitle.textContent = copy[state].title;
  stateDescription.textContent = view.error
    ? `Fail-closed: ${view.error}`
    : copy[state].description;

  if (!view.snapshot) return;
  machineActive.textContent = view.snapshot.machineActive
    ? 'Active'
    : 'Inactive · locked';
  checkedBlock.textContent = view.snapshot.blockNumber.toLocaleString('en-US');
  accessExpiry.textContent = formatExpiry(view.snapshot.expiresAt);
}

function formatExpiry(expiresAt: bigint): string {
  if (expiresAt === 0n) return 'No credential recorded';
  const milliseconds = Number(expiresAt) * 1_000;
  if (!Number.isSafeInteger(milliseconds)) return `Unix ${expiresAt}`;
  return `${new Date(milliseconds).toLocaleString()} · Unix ${expiresAt}`;
}

function element<T extends Element>(selector: string): T {
  const found = document.querySelector<T>(selector);
  if (!found) throw new Error(`Missing UI element ${selector}.`);
  return found;
}
