import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import type { Eip1193Provider } from 'ethers';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  WagmiProvider,
  useAccount,
  useConnect,
  useConnectorClient,
  useConnectors,
  useDisconnect,
  useSwitchChain,
  type Connector,
} from 'wagmi';
import {
  PaymentClient,
  loadAppConfig,
  type AppConfig,
  type MachineOffer,
  type UsageActivity,
} from '../contracts.js';
import { ActivityClient } from '../activity.js';
import { describeError } from '../product.js';
import { MarketplaceClient, type MarketplaceSnapshot } from '../marketplace.js';
import { appKit, hasWalletConnect, wagmiConfig } from '../wallet/config.js';
import {
  deriveWalletView,
  describeWalletError,
  SEPOLIA_CHAIN_ID,
  type WalletView,
} from '../wallet/state.js';

interface RuntimeContextValue {
  config?: AppConfig;
  paymentClient?: PaymentClient;
  marketplaceClient?: MarketplaceClient;
  activityClient?: ActivityClient;
  walletProvider?: Eip1193Provider;
  configurationError?: string;
  account?: string;
  chainId?: number;
  connectorName?: string;
  connectors: readonly Connector[];
  correctNetwork: boolean;
  connecting: boolean;
  walletView: WalletView;
  walletError?: string;
  walletOpen: boolean;
  walletConnectConfigured: boolean;
  openWallet: () => void;
  closeWallet: () => void;
  connectWallet: (connector: Connector) => Promise<void>;
  openMobileWallet: () => Promise<void>;
  disconnectWallet: () => Promise<void>;
  switchToSepolia: () => Promise<void>;
  clearWalletError: () => void;
}

const RuntimeContext = createContext<RuntimeContextValue | undefined>(
  undefined,
);
const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 15_000, retry: 1, refetchOnWindowFocus: false },
  },
});

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig} reconnectOnMount>
      <QueryClientProvider client={queryClient}>
        <RuntimeProvider>{children}</RuntimeProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}

function RuntimeProvider({ children }: { children: ReactNode }) {
  const runtime = useMemo(() => {
    try {
      const config = loadAppConfig(import.meta.env);
      const paymentClient = new PaymentClient(config);
      return {
        config,
        paymentClient,
        marketplaceClient: new MarketplaceClient(config),
        activityClient: new ActivityClient(config, paymentClient),
      };
    } catch (error) {
      return { configurationError: describeError(error) };
    }
  }, []);
  const accountState = useAccount();
  const chainId = accountState.chainId;
  const connectors = useConnectors();
  const connect = useConnect();
  const disconnect = useDisconnect();
  const switchChain = useSwitchChain();
  const connectorClient = useConnectorClient();
  const [walletError, setWalletError] = useState<string>();
  const [walletOpen, setWalletOpen] = useState(false);
  const openWallet = useCallback(() => setWalletOpen(true), []);
  const closeWallet = useCallback(() => setWalletOpen(false), []);

  const account = accountState.address;
  const correctNetwork = Boolean(
    accountState.isConnected && chainId === SEPOLIA_CHAIN_ID,
  );
  const connecting =
    accountState.status === 'connecting' ||
    accountState.status === 'reconnecting' ||
    connect.isPending;
  const walletView = deriveWalletView({
    status: accountState.status,
    address: account,
    chainId,
    error: connect.error,
  });
  const walletProvider = connectorClient.data?.transport as unknown as
    Eip1193Provider | undefined;

  const connectWallet = useCallback(
    async (connector: Connector) => {
      setWalletError(undefined);
      try {
        await connect.mutateAsync({ connector });
      } catch (error) {
        setWalletError(describeWalletError(error));
      }
    },
    [connect],
  );

  const disconnectWallet = useCallback(async () => {
    setWalletError(undefined);
    try {
      await disconnect.mutateAsync();
    } catch (error) {
      setWalletError(describeWalletError(error));
    }
  }, [disconnect]);

  const openMobileWallet = useCallback(async () => {
    setWalletError(undefined);
    if (!appKit) {
      setWalletError(
        'WalletConnect requires a Reown project ID in the deployment configuration.',
      );
      return;
    }
    setWalletOpen(false);
    try {
      await appKit.open({ view: 'Connect' });
    } catch (error) {
      setWalletError(describeWalletError(error));
      setWalletOpen(true);
    }
  }, []);

  const switchToSepolia = useCallback(async () => {
    setWalletError(undefined);
    try {
      await switchChain.mutateAsync({ chainId: SEPOLIA_CHAIN_ID });
    } catch (error) {
      setWalletError(describeWalletError(error));
    }
  }, [switchChain]);

  return (
    <RuntimeContext.Provider
      value={{
        ...runtime,
        account,
        chainId,
        connectorName: accountState.connector?.name,
        connectors,
        walletProvider,
        correctNetwork,
        connecting,
        walletView,
        walletError,
        walletOpen,
        walletConnectConfigured: hasWalletConnect,
        openWallet,
        closeWallet,
        connectWallet,
        openMobileWallet,
        disconnectWallet,
        switchToSepolia,
        clearWalletError: () => {
          connect.reset();
          switchChain.reset();
          setWalletError(undefined);
        },
      }}
    >
      {children}
    </RuntimeContext.Provider>
  );
}

export function useRuntime(): RuntimeContextValue {
  const value = useContext(RuntimeContext);
  if (!value) throw new Error('useRuntime must be used inside AppProviders.');
  return value;
}

export function useMachineOffer(machineId?: string) {
  const { config, paymentClient } = useRuntime();
  const resolvedMachineId = machineId ?? config?.machineId;
  return useQuery<MachineOffer>({
    queryKey: ['offer', resolvedMachineId],
    queryFn: async () => {
      if (!paymentClient)
        throw new Error('ProofKey runtime is not configured.');
      if (!resolvedMachineId) throw new Error('A machine ID is required.');
      return paymentClient.loadOffer(resolvedMachineId);
    },
    enabled: Boolean(paymentClient && resolvedMachineId),
    staleTime: 15_000,
  });
}

export function useMachineActivity(machineId?: string) {
  const { paymentClient } = useRuntime();
  return useQuery<UsageActivity[]>({
    queryKey: ['machine-activity', machineId],
    queryFn: () => paymentClient!.loadRecentUsage(machineId!),
    enabled: Boolean(paymentClient && machineId),
    staleTime: 20_000,
  });
}

export function useMarketplace() {
  const { config, marketplaceClient } = useRuntime();
  return useQuery<MarketplaceSnapshot>({
    queryKey: [
      'marketplace',
      config?.machineRegistryAddress,
      config?.registryAddress,
    ],
    queryFn: async () => {
      if (!marketplaceClient)
        throw new Error('ProofKey runtime is not configured.');
      return marketplaceClient.load();
    },
    enabled: Boolean(marketplaceClient),
    staleTime: 30_000,
  });
}
