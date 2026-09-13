import { createAppKit } from '@reown/appkit/react';
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi';
import { createConfig, http } from 'wagmi';
import { sepolia } from 'wagmi/chains';
import { coinbaseWallet, injected } from 'wagmi/connectors';
import { defineChain } from 'viem';
import { liveTestnetConfig } from '../live-config.js';

export const creditcoinTestnet = defineChain({
  id: 102031,
  name: 'Creditcoin CC3 Testnet',
  nativeCurrency: { name: 'Creditcoin', symbol: 'CTC', decimals: 18 },
  rpcUrls: {
    default: {
      http: [
        import.meta.env.VITE_CREDITCOIN_RPC_URL?.trim() ||
          liveTestnetConfig.creditcoinRpcUrl,
      ],
    },
  },
  blockExplorers: {
    default: {
      name: 'Creditcoin Explorer',
      url: 'https://creditcoin-testnet.blockscout.com',
    },
  },
  testnet: true,
});

const walletConnectProjectId =
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID?.trim();
const metadata = {
  name: 'ProofKey',
  description: 'Proof-backed access for real-world machines',
  url: window.location.origin,
  icons: [`${window.location.origin}/proofkey-logo.svg?v=2`],
};
const connectors = [
  injected({ shimDisconnect: true }),
  coinbaseWallet(),
] as const;
const transports = {
  [sepolia.id]: http(
    import.meta.env.VITE_ETHEREUM_SEPOLIA_RPC_URL?.trim() ||
      liveTestnetConfig.sepoliaRpcUrl,
  ),
  [creditcoinTestnet.id]: http(
    import.meta.env.VITE_CREDITCOIN_RPC_URL?.trim() ||
      liveTestnetConfig.creditcoinRpcUrl,
  ),
};

const adapter = walletConnectProjectId
  ? new WagmiAdapter({
      networks: [sepolia, creditcoinTestnet],
      projectId: walletConnectProjectId,
      connectors,
      multiInjectedProviderDiscovery: true,
      transports,
    })
  : undefined;

export const wagmiConfig =
  adapter?.wagmiConfig ??
  createConfig({
    chains: [sepolia, creditcoinTestnet],
    connectors,
    multiInjectedProviderDiscovery: true,
    transports,
  });

export const appKit =
  adapter && walletConnectProjectId
    ? createAppKit({
        adapters: [adapter],
        networks: [sepolia, creditcoinTestnet],
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
