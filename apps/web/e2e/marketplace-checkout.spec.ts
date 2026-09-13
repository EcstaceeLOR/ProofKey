import { expect, test, type Page } from '@playwright/test';
import { Interface } from 'ethers';

const machineId =
  '0xc04beae61beb9471c4f24c8788a4624988d2948a5c3d3dd0b6ba1b7602875bcc';
const owner = '0x1114eeafeb92b71babf860e64e4575433a734b6a';
const tokenAddress = '0x0000000000000000000000000000000000000003';
const metadataHash =
  '0x24f58d3fcaa80aa0cbe4c88b0ce7d4a23312fa95ca201300a7313894970e883e';
const machineInterface = new Interface([
  'function machines(bytes32) view returns (address owner,address controller,bytes32 metadataHash,uint128 tariff,bool active)',
]);
const paymentInterface = new Interface([
  'function machineOffers(bytes32) view returns (address beneficiary,uint128 pricePerSecond,bool active)',
  'function paymentToken() view returns (address)',
]);
const tokenInterface = new Interface([
  'function decimals() view returns (uint8)',
  'function symbol() view returns (string)',
]);
const usageInterface = new Interface([
  'event UsagePaid(bytes32 indexed orderId,bytes32 indexed machineId,address indexed payer,address beneficiary,uint64 startTime,uint64 duration,uint256 amount)',
]);
const accessInterface = new Interface([
  'function accessCredentials(bytes32,address) view returns (bytes32 authorizationId,uint64 expiresAt)',
  'function isAuthorized(bytes32,address) view returns (bool)',
]);
const proofInterface = new Interface([
  'function processedOrders(bytes32) view returns (bool)',
  'event ProofKeyAccessActivated(bytes32 indexed queryId,bytes32 indexed orderId,bytes32 indexed machineId,address payer,uint64 expiresAt)',
]);
const orderId = `0x${'ee'.repeat(32)}`;

test('Explore, machine detail, and checkout form one verified journey', async ({
  page,
}) => {
  await mockMarketplaceRpc(page);
  await page.goto('/explore');
  await expect(
    page.getByRole('heading', { name: 'Industrial Excavator' }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByRole('link', { name: 'View machine' }).click();
  await expect(page).toHaveURL(new RegExp(`/machines/${machineId}$`));
  await expect(page.getByText('22-ton operating capacity')).toBeVisible();
  const bookingLink = page.getByRole('link', { name: /Book machine time/ });
  await expect(bookingLink).toHaveAttribute('href', `/rent/${machineId}`);
  await page.goto(`/rent/${machineId}`);
  await expect(page).toHaveURL(new RegExp(`/rent/${machineId}$`));
  await expect(
    page.getByRole('heading', { name: 'Choose operating time' }),
  ).toBeVisible({ timeout: 15_000 });
  await page.getByLabel('Custom duration in seconds').fill('7200');
  await page.getByRole('button', { name: 'Review exact rental' }).click();
  await expect(
    page.getByRole('heading', { name: 'Review exact terms' }),
  ).toBeVisible();
  await expect(page.getByText('2 hours', { exact: true })).toBeVisible();
});

test('checkout fails closed when registry RPC is unavailable', async ({
  page,
}) => {
  await page.route('https://**.rpc.proofkey.invalid/**', (route) =>
    route.abort(),
  );
  await page.goto(`/rent/${machineId}`);
  await expect(
    page.getByText('Checkout cannot verify the machine'),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
});

test('a fresh connected browser recovers active access from chain and relay state', async ({
  page,
}) => {
  await installWallet(page);
  await mockMarketplaceRpc(page, true);
  await page.route('https://relay.invalid/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sourceTransactionHash: `0x${'fa'.repeat(32)}`,
        phase: 'completed',
        orderId,
        machineId,
        payer: owner,
        accessExpiresAt: '2500',
        creditcoinTransactionHash: `0x${'ab'.repeat(32)}`,
      }),
    });
  });
  await page.goto('/activity');
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Connect wallet' })
    .click();
  await page.getByRole('button', { name: /Playwright Wallet/ }).click();
  await expect(page.getByText('Machine access active')).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('link', { name: /Open access/ })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Download receipt JSON' }),
  ).toBeVisible();
});

async function mockMarketplaceRpc(page: Page, includeUsage = false) {
  await page.route('https://**.rpc.proofkey.invalid/**', async (route) => {
    const request = route.request();
    const payload = request.postDataJSON() as RpcRequest | RpcRequest[];
    const isCreditcoin = request.url().includes('creditcoin');
    const requests = Array.isArray(payload) ? payload : [payload];
    const responses = requests.map((rpc) => ({
      jsonrpc: '2.0',
      id: rpc.id,
      result: rpcResult(rpc, isCreditcoin, includeUsage),
    }));
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(Array.isArray(payload) ? responses : responses[0]),
    });
  });
}

interface RpcRequest {
  id: number;
  method: string;
  params?: unknown[];
}

function rpcResult(
  rpc: RpcRequest,
  isCreditcoin: boolean,
  includeUsage: boolean,
) {
  let result: unknown;
  if (rpc.method === 'eth_chainId')
    result = isCreditcoin ? '0x18e8f' : '0xaa36a7';
  else if (rpc.method === 'eth_blockNumber')
    result = isCreditcoin ? '0x539000' : '0xb26c00';
  else if (rpc.method === 'eth_getLogs') {
    const topics = (rpc.params?.[0] as { topics?: unknown[] })?.topics ?? [];
    const isUsageQuery = topics.length > 1 && topics[1] === null;
    const firstTopic = Array.isArray(topics[0])
      ? (topics[0] as string[])[0]
      : topics[0];
    result =
      firstTopic ===
      proofInterface.getEvent('ProofKeyAccessActivated')!.topicHash
        ? [activation()]
        : isUsageQuery
          ? includeUsage
            ? [usagePaid()]
            : []
          : isCreditcoin
            ? [cc3Registration()]
            : [sepoliaOffer()];
  } else if (rpc.method === 'eth_getBlockByNumber') {
    result = creditcoinBlock();
  } else if (rpc.method === 'eth_call') {
    const call = rpc.params?.[0] as { to: string; data: string };
    const target = call.to.toLowerCase();
    if (target.endsWith('05'))
      result = proofInterface.encodeFunctionResult('processedOrders', [true]);
    else if (
      target.endsWith('04') &&
      call.data.startsWith(
        accessInterface.getFunction('accessCredentials')!.selector,
      )
    )
      result = accessInterface.encodeFunctionResult('accessCredentials', [
        orderId,
        2500,
      ]);
    else if (target.endsWith('04'))
      result = accessInterface.encodeFunctionResult('isAuthorized', [true]);
    else if (target.endsWith('02'))
      result = machineInterface.encodeFunctionResult('machines', [
        owner,
        owner,
        metadataHash,
        2500n,
        true,
      ]);
    else if (
      target.endsWith('01') &&
      call.data.startsWith(
        paymentInterface.getFunction('machineOffers')!.selector,
      )
    )
      result = paymentInterface.encodeFunctionResult('machineOffers', [
        owner,
        2500n,
        true,
      ]);
    else if (target.endsWith('01'))
      result = paymentInterface.encodeFunctionResult('paymentToken', [
        tokenAddress,
      ]);
    else if (
      call.data.startsWith(tokenInterface.getFunction('decimals')!.selector)
    )
      result = tokenInterface.encodeFunctionResult('decimals', [6]);
    else result = tokenInterface.encodeFunctionResult('symbol', ['pkUSDC']);
  } else result = '0x0';
  return result;
}

function usagePaid() {
  const encoded = usageInterface.encodeEventLog(
    usageInterface.getEvent('UsagePaid')!,
    [orderId, machineId, owner, owner, 1500, 1000, 2_500_000],
  );
  return {
    address: '0x0000000000000000000000000000000000000001',
    blockHash: `0x${'a1'.repeat(32)}`,
    blockNumber: '0xb26bfe',
    transactionHash: `0x${'fa'.repeat(32)}`,
    transactionIndex: '0x0',
    logIndex: '0x0',
    removed: false,
    topics: encoded.topics,
    data: encoded.data,
  };
}

function activation() {
  const encoded = proofInterface.encodeEventLog(
    proofInterface.getEvent('ProofKeyAccessActivated')!,
    [`0x${'12'.repeat(32)}`, orderId, machineId, owner, 2500],
  );
  return {
    address: '0x0000000000000000000000000000000000000005',
    blockHash: `0x${'a2'.repeat(32)}`,
    blockNumber: '0x539010',
    transactionHash: `0x${'ab'.repeat(32)}`,
    transactionIndex: '0x0',
    logIndex: '0x0',
    removed: false,
    topics: encoded.topics,
    data: encoded.data,
  };
}

function creditcoinBlock() {
  return {
    number: '0x539100',
    hash: `0x${'01'.repeat(32)}`,
    parentHash: `0x${'02'.repeat(32)}`,
    nonce: '0x0000000000000000',
    sha3Uncles: `0x${'03'.repeat(32)}`,
    logsBloom: `0x${'00'.repeat(256)}`,
    transactionsRoot: `0x${'04'.repeat(32)}`,
    stateRoot: `0x${'05'.repeat(32)}`,
    receiptsRoot: `0x${'06'.repeat(32)}`,
    miner: owner,
    difficulty: '0x0',
    totalDifficulty: '0x0',
    extraData: '0x',
    size: '0x1',
    gasLimit: '0x1c9c380',
    gasUsed: '0x0',
    timestamp: '0x7d0',
    transactions: [],
    uncles: [],
    baseFeePerGas: '0x1',
  };
}

async function installWallet(page: Page) {
  await page.addInitScript(
    ({ approvedAccount }) => {
      type Listener = (...arguments_: unknown[]) => void;
      const listeners = new Map<string, Set<Listener>>();
      const provider = {
        request: async ({ method }: { method: string }) => {
          if (method === 'eth_chainId') return '0xaa36a7';
          if (method === 'eth_accounts')
            return localStorage.getItem('approved') ? [approvedAccount] : [];
          if (method === 'eth_requestAccounts') {
            localStorage.setItem('approved', 'yes');
            queueMicrotask(() =>
              listeners
                .get('accountsChanged')
                ?.forEach((listener) => listener([approvedAccount])),
            );
            return [approvedAccount];
          }
          throw Object.assign(
            new Error(`Unsupported wallet method: ${method}`),
            { code: 4200 },
          );
        },
        on: (event: string, listener: Listener) => {
          const set = listeners.get(event) ?? new Set<Listener>();
          set.add(listener);
          listeners.set(event, set);
        },
        removeListener: (event: string, listener: Listener) =>
          listeners.get(event)?.delete(listener),
      };
      const detail = {
        info: {
          uuid: '450670db-19fa-4704-a166-e52e178b59d2',
          name: 'Playwright Wallet',
          icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
          rdns: 'io.proofkey.activity',
        },
        provider,
      };
      const announce = () =>
        window.dispatchEvent(
          new CustomEvent('eip6963:announceProvider', { detail }),
        );
      Object.defineProperty(window, 'ethereum', { value: provider });
      window.addEventListener('eip6963:requestProvider', announce);
      queueMicrotask(announce);
    },
    { approvedAccount: owner },
  );
}

function cc3Registration() {
  return {
    address: '0x0000000000000000000000000000000000000002',
    blockHash: `0x${'aa'.repeat(32)}`,
    blockNumber: '0x539006',
    transactionHash: `0x${'bb'.repeat(32)}`,
    transactionIndex: '0x0',
    logIndex: '0x0',
    removed: false,
    topics: [
      '0x986cbf5e3020e941aeaa92bffac52f24650187bfc582c05c3bee4bb284f31d77',
      machineId,
      `0x${'0'.repeat(24)}${owner.slice(2)}`,
      `0x${'0'.repeat(24)}${owner.slice(2)}`,
    ],
    data: `${metadataHash}${'0'.repeat(60)}09c4${'0'.repeat(63)}1`,
  };
}

function sepoliaOffer() {
  return {
    address: '0x0000000000000000000000000000000000000001',
    blockHash: `0x${'cc'.repeat(32)}`,
    blockNumber: '0xb26bff',
    transactionHash: `0x${'dd'.repeat(32)}`,
    transactionIndex: '0x0',
    logIndex: '0x0',
    removed: false,
    topics: [
      '0x7fe5f9ca822b5223f722e4b037ac183e3131d3747c2c4d537baf6b51448ce923',
      machineId,
      `0x${'0'.repeat(24)}${owner.slice(2)}`,
    ],
    data: `0x${'0'.repeat(60)}09c4${'0'.repeat(63)}1`,
  };
}
