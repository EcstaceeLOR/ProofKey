/// <reference types="vite/client" />

import type { Eip1193Provider } from 'ethers';

declare global {
  interface Window {
    ethereum?: Eip1193Provider & {
      on?: (
        event: string,
        listener: (...arguments_: unknown[]) => void,
      ) => void;
      removeListener?: (
        event: string,
        listener: (...arguments_: unknown[]) => void,
      ) => void;
    };
  }
}

interface ImportMetaEnv {
  readonly VITE_ETHEREUM_SEPOLIA_RPC_URL?: string;
  readonly VITE_CREDITCOIN_RPC_URL?: string;
  readonly VITE_USAGE_PAYMENT_REGISTRY_ADDRESS?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
  readonly VITE_MACHINE_REGISTRY_ADDRESS?: string;
  readonly VITE_DEMO_MACHINE_ID?: string;
  readonly VITE_PROOF_WORKER_URL?: string;
  readonly VITE_SEPOLIA_EXPLORER_URL?: string;
  readonly VITE_CREDITCOIN_EXPLORER_URL?: string;
  readonly VITE_DEMO_MACHINE_NAME?: string;
  readonly VITE_DEMO_MACHINE_LOCATION?: string;
  readonly VITE_MACHINE_REGISTRY_DEPLOYMENT_BLOCK?: string;
  readonly VITE_USAGE_PAYMENT_REGISTRY_DEPLOYMENT_BLOCK?: string;
  readonly VITE_ACCESS_PASS_ADDRESS?: string;
  readonly VITE_PROOFKEY_ASC_ADDRESS?: string;
  readonly VITE_PROOFKEY_ASC_DEPLOYMENT_BLOCK?: string;
}
