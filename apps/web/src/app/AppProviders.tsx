import {
  QueryClient,
  QueryClientProvider,
  useQuery,
} from '@tanstack/react-query';
import { BrowserProvider } from 'ethers';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  PaymentClient,
  loadAppConfig,
  type AppConfig,
  type MachineOffer,
} from '../contracts.js';
import { describeError } from '../product.js';

interface RuntimeContextValue {
  config?: AppConfig;
  paymentClient?: PaymentClient;
  configurationError?: string;
  account?: string;
  correctNetwork: boolean;
  connecting: boolean;
  walletError?: string;
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
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
    <QueryClientProvider client={queryClient}>
      <RuntimeProvider>{children}</RuntimeProvider>
    </QueryClientProvider>
  );
}

function RuntimeProvider({ children }: { children: ReactNode }) {
  const runtime = useMemo(() => {
    try {
      const config = loadAppConfig(import.meta.env);
      return { config, paymentClient: new PaymentClient(config) };
    } catch (error) {
      return { configurationError: describeError(error) };
    }
  }, []);
  const [account, setAccount] = useState<string>();
  const [correctNetwork, setCorrectNetwork] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [walletError, setWalletError] = useState<string>();

  const refreshNetwork = useCallback(async () => {
    if (!window.ethereum) return setCorrectNetwork(false);
    try {
      const chainId = (await window.ethereum.request({
        method: 'eth_chainId',
      })) as string;
      setCorrectNetwork(Number.parseInt(chainId, 16) === 11155111);
    } catch {
      setCorrectNetwork(false);
    }
  }, []);

  useEffect(() => {
    if (!window.ethereum) return;
    const ethereum = window.ethereum;
    const handleChainChanged = () => void refreshNetwork();
    const handleAccountsChanged = (...arguments_: unknown[]) => {
      const accounts = arguments_[0];
      setAccount(
        Array.isArray(accounts) && typeof accounts[0] === 'string'
          ? accounts[0]
          : undefined,
      );
    };
    ethereum.on?.('chainChanged', handleChainChanged);
    ethereum.on?.('accountsChanged', handleAccountsChanged);
    void refreshNetwork();
    return () => {
      ethereum.removeListener?.('chainChanged', handleChainChanged);
      ethereum.removeListener?.('accountsChanged', handleAccountsChanged);
    };
  }, [refreshNetwork]);

  const connectWallet = useCallback(async () => {
    setConnecting(true);
    setWalletError(undefined);
    try {
      if (!window.ethereum)
        throw new Error(
          'No browser wallet found. Install an EVM wallet to continue.',
        );
      await window.ethereum.request({ method: 'eth_requestAccounts' });
      const provider = new BrowserProvider(window.ethereum);
      setAccount(await (await provider.getSigner()).getAddress());
      await refreshNetwork();
    } catch (error) {
      setWalletError(describeError(error));
    } finally {
      setConnecting(false);
    }
  }, [refreshNetwork]);

  const switchToSepolia = useCallback(async () => {
    setWalletError(undefined);
    try {
      if (!runtime.paymentClient) throw new Error(runtime.configurationError);
      await runtime.paymentClient.switchToSepolia();
      await refreshNetwork();
    } catch (error) {
      setWalletError(describeError(error));
      throw error;
    }
  }, [refreshNetwork, runtime]);

  return (
    <RuntimeContext.Provider
      value={{
        ...runtime,
        account,
        correctNetwork,
        connecting,
        walletError,
        connectWallet,
        disconnectWallet: () => setAccount(undefined),
        switchToSepolia,
        clearWalletError: () => setWalletError(undefined),
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

export function useMachineOffer() {
  const { config, paymentClient } = useRuntime();
  return useQuery<MachineOffer>({
    queryKey: ['offer', config?.machineId],
    queryFn: async () => {
      if (!paymentClient)
        throw new Error('ProofKey runtime is not configured.');
      return paymentClient.loadOffer();
    },
    enabled: Boolean(paymentClient),
    staleTime: 15_000,
  });
}
