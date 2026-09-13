import { createAppKit } from '@reown/appkit/react';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { createConfig, http } from 'wagmi';
import { sepolia } from 'wagmi/chains';
import { coinbaseWallet, injected } from 'wagmi/connectors';

const walletConnectProjectId =
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim();
const metadata = {
  name: 'ProofKey',
  description: 'Proof-backed access for real-world machines',
  url: window.location.origin,
  icons: [`${window.location.origin}/favicon.svg`],
};
const connectors = [
  injected({ shimDisconnect: true }),
  coinbaseWallet(),
] as const;
const transports = {
  [sepolia.id]: http(
    import.meta.env.VITE_ETHEREUM_SEPOLIA_RPC_URL?.trim() || undefined,
  ),
};

const adapter = walletConnectProjectId
  ? new WagmiAdapter({
      networks: [sepolia],
      projectId: walletConnectProjectId,
      connectors,
      multiInjectedProviderDiscovery: true,
      transports,
    })
  : undefined;

export const wagmiConfig =
  adapter?.wagmiConfig ??
  createConfig({
    chains: [sepolia],
    connectors,
    multiInjectedProviderDiscovery: true,
    transports,
  });

export const appKit =
  adapter && walletConnectProjectId
    ? createAppKit({
        adapters: [adapter],
        networks: [sepolia],
        projectId: walletConnectProjectId,
        metadata,
        themeMode: 'light',
        features: {
          analytics: false,
          email: false,
          socials: false,
        },
      })
    : undefined;

export const hasWalletConnect = Boolean(appKit);

declare module 'wagmi' {
  interface Register {
    config: typeof wagmiConfig;
  }
}
