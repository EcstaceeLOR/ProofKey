export type MachineState = 'locked' | 'unlocking' | 'unlocked' | 'expired';

export interface AuthorizationSnapshot {
  authorized: boolean;
  authorizationId: string;
  expiresAt: bigint;
  machineActive: boolean;
  blockNumber: number;
}

export interface AuthorizationReader {
  read(): Promise<AuthorizationSnapshot>;
}

export interface MachineView {
  state: MachineState;
  snapshot?: AuthorizationSnapshot;
  error?: string;
}

export type MachineViewListener = (view: MachineView) => void;

export function deriveMachineState(
  snapshot: AuthorizationSnapshot,
  nowSeconds: bigint,
): MachineState {
  if (
    snapshot.authorized &&
    snapshot.machineActive &&
    snapshot.expiresAt > nowSeconds
  ) {
    return 'unlocked';
  }
  if (snapshot.expiresAt > 0n && snapshot.expiresAt <= nowSeconds)
    return 'expired';
  return 'locked';
}

export class MachineController {
  private view: MachineView = { state: 'locked' };
  private inFlight?: Promise<void>;

  constructor(
    private readonly reader: AuthorizationReader,
    private readonly listener: MachineViewListener,
    private readonly nowSeconds: () => bigint = () =>
      BigInt(Math.floor(Date.now() / 1_000)),
  ) {
    this.listener(this.view);
  }

  get current(): MachineView {
    return this.view;
  }

  refresh(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.performRefresh().finally(() => {
      this.inFlight = undefined;
    });
    return this.inFlight;
  }

  tick(): void {
    if (!this.view.snapshot) return;
    const state = deriveMachineState(this.view.snapshot, this.nowSeconds());
    if (state !== this.view.state) this.publish({ ...this.view, state });
  }

  private async performRefresh(): Promise<void> {
    if (this.view.state !== 'unlocked') {
      this.publish({ ...this.view, state: 'unlocking', error: undefined });
    }
    try {
      const snapshot = await this.reader.read();
      this.publish({
        state: deriveMachineState(snapshot, this.nowSeconds()),
        snapshot,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.publish({ state: 'locked', error: message });
    }
  }

  private publish(view: MachineView): void {
    this.view = view;
    this.listener(view);
  }
}
