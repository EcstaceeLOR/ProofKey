import { expect, test, type Page } from '@playwright/test';
import { Interface, Wallet, hexlify, keccak256, toUtf8Bytes } from 'ethers';
import {
  usageReceiptMessage,
  type UsageReceiptPayload,
} from '../src/device-session.js';

const machineId =
  '0xc04beae61beb9471c4f24c8788a4624988d2948a5c3d3dd0b6ba1b7602875bcc';
const controllerWallet = new Wallet(`0x${'01'.repeat(32)}`);
const owner = controllerWallet.address.toLowerCase();
const tokenAddress = '0x0000000000000000000000000000000000000003';
const metadataHash =
  '0x24f58d3fcaa80aa0cbe4c88b0ce7d4a23312fa95ca201300a7313894970e883e';
const machineInterface = new Interface([
  'function machines(bytes32) view returns (address owner,address controller,bytes32 metadataHash,uint128 tariff,bool active)',
]);
const paymentInterface = new Interface([
  'function machineOffers(bytes32) view returns (address beneficiary,uint128 pricePerSecond,bool active)',
  'function paymentToken() view returns (address)',
  'function owner() view returns (address)',
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
  await expect(page).toHaveURL(new RegExp(`/machines/${machineId}$`), {
    timeout: 15_000,
  });
  await expect(page.getByText('22-ton operating capacity')).toBeVisible();
  const bookingLink = page.getByRole('link', { name: /Book machine time/ });
  await expect(bookingLink).toHaveAttribute('href', `/rent/${machineId}`);
  await bookingLink.click();
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
  await page.goto(`/rent/${machineId}`, { waitUntil: 'domcontentloaded' });
  await expect(
    page.getByText('Checkout cannot verify the machine'),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible({
    timeout: 15_000,
  });
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
  await expect(page.getByRole('link', { name: /Start session/ })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Download receipt JSON' }),
  ).toBeVisible();
});

test('proof explorer resolves an order ID and recomputes every cross-chain invariant', async ({
  page,
}) => {
  await mockMarketplaceRpc(page);
  await page.route('https://relay.invalid/proofs/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(publicProofEvidence()),
    });
  });
  await page.goto(`/proofs/${orderId}`);

  await expect(
    page.getByRole('heading', { name: 'Access verified on Creditcoin' }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.locator('.invariant-row.pass')).toHaveCount(11);
  await expect(page.getByText('Native query proof')).toBeVisible();
  await expect(page.getByText('Continuity path')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Download JSON' }),
  ).toBeVisible();
});

test('operator metadata upload fails closed then resumes the confirmed onboarding step', async ({
  page,
}) => {
  await installWallet(page);
  await mockMarketplaceRpc(page);
  const digest = `0x${'71'.repeat(32)}`;
  const uri = `https://relay.invalid/metadata/${digest}`;
  const commitment = keccak256(toUtf8Bytes(uri));
  let uploads = 0;
  await page.route('https://relay.invalid/metadata', async (route) => {
    uploads += 1;
    if (uploads === 1)
      return route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { message: 'Metadata storage is temporarily unavailable.' },
        }),
      });
    await route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        contentDigest: digest,
        commitment,
        uri,
        document: { name: 'Autonomous Wheel Loader' },
        createdAt: '2026-09-13T12:00:00.000Z',
      }),
    });
  });
  await page.goto('/operator');
  await page
    .getByRole('main')
    .getByRole('button', { name: 'Connect wallet' })
    .click();
  await page.getByRole('button', { name: /Playwright Wallet/ }).click();
  await page.getByRole('button', { name: 'Close wallet dialog' }).click();
  await page.getByRole('button', { name: /Onboard machine/ }).click();
  await page.getByLabel('Permanent machine label').fill('fleet.loader.042');
  await page.getByLabel('Display name').fill('Autonomous Wheel Loader');
  await page.getByLabel('Category').fill('Construction');
  await page.getByLabel('City').fill('Lagos');
  await page.getByLabel('Country').fill('Nigeria');
  await page.getByLabel('Site / bay').fill('Lekki Yard · Bay 2');
  await page.getByLabel('Tariff (token units / second)').fill('2500');
  await page
    .getByLabel('Description')
    .fill('A proof-gated wheel loader for a construction site.');

  await page
    .getByRole('button', { name: /Upload metadata and lock commitment/ })
    .click();
  await expect(
    page.getByText('Metadata storage is temporarily unavailable.'),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Build verifiable metadata' }),
  ).toBeVisible();

  await page
    .getByRole('button', { name: /Upload metadata and lock commitment/ })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Register the machine identity' }),
  ).toBeVisible();
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Register the machine identity' }),
  ).toBeVisible();
  await page.evaluate(() =>
    localStorage.setItem('reject-next-transaction', 'yes'),
  );
  await page.getByRole('button', { name: /Confirm CC3 registration/ }).click();
  await expect(
    page.getByText('Wallet request cancelled. Nothing was charged.'),
  ).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Register the machine identity' }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Confirm CC3 registration/ }).click();
  await expect(
    page.getByRole('heading', { name: 'Synchronize the rental offer' }),
  ).toBeVisible({ timeout: 15_000 });
  await page
    .getByRole('button', { name: /Publish synchronized offer/ })
    .click();
  await expect(page.getByText('ONBOARDING COMPLETE')).toBeVisible({
    timeout: 15_000,
  });
});

test('customer and device browsers complete a one-time signed machine session', async ({
  browser,
}) => {
  const nonce = 'a7'.repeat(32);
  const sourceHash = `0x${'fa'.repeat(32)}`;
  const startedAt = '1970-01-01T00:33:20.000Z';
  const sessionId = keccak256(toUtf8Bytes(`proofkey-device-session:${nonce}`));
  const startPayload: UsageReceiptPayload = {
    schema: 'proofkey.usage-receipt.v1',
    kind: 'start',
    sessionId,
    machineId,
    payer: controllerWallet.address,
    orderId,
    nonce,
    controller: controllerWallet.address,
    startedAt,
    endedAt: null,
    measuredDurationSeconds: 0,
    accessExpiresAt: '2500',
  };
  const endPayload: UsageReceiptPayload = {
    ...startPayload,
    kind: 'end',
    endedAt: startedAt,
  };
  const signedMessages = {
    [hexlify(toUtf8Bytes(usageReceiptMessage(startPayload)))]:
      await controllerWallet.signMessage(usageReceiptMessage(startPayload)),
    [hexlify(toUtf8Bytes(usageReceiptMessage(endPayload)))]:
      await controllerWallet.signMessage(usageReceiptMessage(endPayload)),
  };
  let handoff = {
    schema: 'proofkey.device-handoff.v1' as const,
    nonce,
    machineId,
    payer: controllerWallet.address,
    orderId,
    sourceTransactionHash: sourceHash,
    accessExpiresAt: '2500',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 120_000).toISOString(),
    claimedAt: undefined as string | undefined,
    startReceipt: undefined as
      { payload: UsageReceiptPayload; signature: string } | undefined,
    endReceipt: undefined as
      { payload: UsageReceiptPayload; signature: string } | undefined,
  };
  const claimToken = 'c8'.repeat(32);

  const customerContext = await browser.newContext();
  const deviceContext = await browser.newContext();
  const replayContext = await browser.newContext();
  const customer = await customerContext.newPage();
  const device = await deviceContext.newPage();
  const replay = await replayContext.newPage();
  for (const page of [customer, device, replay]) {
    await installWallet(page, signedMessages);
    await mockMarketplaceRpc(page, true);
    await mockDeviceRelay(
      page,
      () => handoff,
      (next) => (handoff = next),
      claimToken,
    );
  }

  await customer.goto(`/sessions/${sourceHash}`);
  await customer.getByRole('button', { name: 'Connect renter wallet' }).click();
  await customer.getByRole('button', { name: /Playwright Wallet/ }).click();
  await customer.getByRole('button', { name: 'Close wallet dialog' }).click();
  await customer.getByRole('button', { name: 'Generate one-time QR' }).click();
  await expect(
    customer.getByAltText('One-time device handoff QR code'),
  ).toBeVisible({ timeout: 15_000 });

  const deviceUrl = `/device/${machineId}?handoff=${nonce}&payer=${controllerWallet.address}`;
  await replay.goto(
    `/device/0x${'99'.repeat(32)}?handoff=${nonce}&payer=${controllerWallet.address}`,
  );
  await expect(
    replay.getByText(
      'QR is bound to a different machine. Device remains locked.',
    ),
  ).toBeVisible({ timeout: 15_000 });
  await replay.goto(
    `/device/${machineId}?handoff=${nonce}&payer=0x2222222222222222222222222222222222222222`,
  );
  await expect(
    replay.getByText(
      'QR is bound to a different payer. Device remains locked.',
    ),
  ).toBeVisible({ timeout: 15_000 });

  await device.goto(deviceUrl);
  await expect(device.getByText('Verified · ready')).toBeVisible({
    timeout: 15_000,
  });
  await device
    .getByRole('button', { name: 'Connect controller wallet' })
    .click();
  await device.getByRole('button', { name: /Playwright Wallet/ }).click();
  await device.getByRole('button', { name: 'Close wallet dialog' }).click();
  await device
    .getByRole('button', { name: /Sign start & enable machine/ })
    .click();
  await expect(device.getByText('Equipment enabled')).toBeVisible({
    timeout: 15_000,
  });
  await device.reload();
  await expect(device.getByText('Equipment enabled')).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    customer.getByRole('heading', { name: 'Machine session active' }),
  ).toBeVisible({ timeout: 15_000 });

  await device
    .getByRole('button', { name: /Stop & sign usage receipt/ })
    .click();
  await expect(device.getByText('Session stopped')).toBeVisible({
    timeout: 15_000,
  });
  await expect(
    customer.getByRole('heading', { name: 'Usage stopped and sealed' }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    customer.getByText('Controller signature verified locally.'),
  ).toHaveCount(2);

  await customer.goto('/activity');
  await expect(customer.getByText('Signed usage receipt')).toBeVisible({
    timeout: 15_000,
  });
  await expect(customer.getByText('Controller verified locally')).toBeVisible();

  await replay.goto(deviceUrl);
  await expect(
    replay.getByText('This QR handoff was already claimed by a device.'),
  ).toBeVisible({ timeout: 15_000 });

  await Promise.all([
    customerContext.close(),
    deviceContext.close(),
    replayContext.close(),
  ]);
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
  else if (rpc.method === 'eth_getTransactionByHash')
    result = sourceTransaction(rpc.params?.[0] as string);
  else if (rpc.method === 'eth_getTransactionReceipt')
    result = isCreditcoin ? creditcoinReceipt() : sourceReceipt();
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
      result = call.data.startsWith(
        paymentInterface.getFunction('owner')!.selector,
      )
        ? paymentInterface.encodeFunctionResult('owner', [owner])
        : paymentInterface.encodeFunctionResult('paymentToken', [tokenAddress]);
    else if (
      call.data.startsWith(tokenInterface.getFunction('decimals')!.selector)
    )
      result = tokenInterface.encodeFunctionResult('decimals', [6]);
    else result = tokenInterface.encodeFunctionResult('symbol', ['pkUSDC']);
  } else result = '0x0';
  return result;
}

function publicProofEvidence() {
  return {
    schema: 'proofkey.public-proof.v1',
    source: {
      transactionHash: `0x${'fa'.repeat(32)}`,
      blockNumber: 11_693_054,
      payment: {
        orderId,
        machineId,
        payer: owner,
        beneficiary: owner,
        startTime: '1500',
        duration: '1000',
        amount: '2500000',
      },
    },
    relay: {
      phase: 'completed',
      createdAt: '2026-09-13T10:00:00.000Z',
      updatedAt: '2026-09-13T10:05:00.000Z',
      attempts: { proof_generation: 1, creditcoin_execution: 1 },
    },
    attestcoin: {
      chainKey: 1,
      blockHeight: 11_693_054,
      encodedTransaction: '0x01',
      merkleRoot: `0x${'31'.repeat(32)}`,
      siblings: [{ hash: `0x${'32'.repeat(32)}`, isLeft: true }],
      lowerEndpointDigest: `0x${'33'.repeat(32)}`,
      continuityRoots: [`0x${'34'.repeat(32)}`],
    },
    creditcoin: {
      transactionHash: `0x${'ab'.repeat(32)}`,
      queryId: `0x${'12'.repeat(32)}`,
      accessExpiresAt: '2500',
    },
  };
}

function sourceTransaction(hash: string) {
  return {
    hash,
    blockHash: `0x${'a1'.repeat(32)}`,
    blockNumber: '0xb26bfe',
    transactionIndex: '0x0',
    from: owner,
    to: '0x0000000000000000000000000000000000000001',
    nonce: '0x1',
    gas: '0x5208',
    gasPrice: '0x1',
    input: '0x',
    value: '0x0',
    type: '0x0',
    chainId: '0xaa36a7',
    v: '0x1b',
    r: `0x${'01'.repeat(32)}`,
    s: `0x${'02'.repeat(32)}`,
  };
}

function sourceReceipt() {
  return transactionReceipt(
    `0x${'fa'.repeat(32)}`,
    `0x${'a1'.repeat(32)}`,
    '0xb26bfe',
    '0x0000000000000000000000000000000000000001',
    [usagePaid()],
  );
}

function creditcoinReceipt() {
  return transactionReceipt(
    `0x${'ab'.repeat(32)}`,
    `0x${'a2'.repeat(32)}`,
    '0x539010',
    '0x0000000000000000000000000000000000000005',
    [activation()],
  );
}

function transactionReceipt(
  transactionHash: string,
  blockHash: string,
  blockNumber: string,
  to: string,
  logs: unknown[],
) {
  return {
    transactionHash,
    transactionIndex: '0x0',
    blockHash,
    blockNumber,
    from: owner,
    to,
    cumulativeGasUsed: '0x5208',
    gasUsed: '0x5208',
    contractAddress: null,
    logs,
    logsBloom: `0x${'00'.repeat(256)}`,
    status: '0x1',
    effectiveGasPrice: '0x1',
    type: '0x0',
  };
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

async function installWallet(
  page: Page,
  signedMessages: Record<string, string> = {},
) {
  await page.addInitScript(
    ({ approvedAccount, signatures }) => {
      type Listener = (...arguments_: unknown[]) => void;
      const listeners = new Map<string, Set<Listener>>();
      let chainId = '0xaa36a7';
      let transactionCount = 0;
      const transactions = new Map<string, Record<string, unknown>>();
      const provider = {
        request: async ({
          method,
          params,
        }: {
          method: string;
          params?: unknown[];
        }) => {
          if (method === 'eth_chainId') return chainId;
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
          if (method === 'wallet_switchEthereumChain') {
            chainId = (params?.[0] as { chainId: string }).chainId;
            queueMicrotask(() =>
              listeners
                .get('chainChanged')
                ?.forEach((listener) => listener(chainId)),
            );
            return null;
          }
          if (method === 'wallet_addEthereumChain') {
            chainId = (params?.[0] as { chainId: string }).chainId;
            return null;
          }
          if (method === 'personal_sign') {
            const message = String(params?.[0] ?? '').toLowerCase();
            const signature = signatures[message];
            if (!signature)
              throw Object.assign(new Error('Unexpected message to sign'), {
                code: 4001,
              });
            return signature;
          }
          if (method === 'eth_sendTransaction') {
            if (localStorage.getItem('reject-next-transaction')) {
              localStorage.removeItem('reject-next-transaction');
              throw Object.assign(new Error('User rejected request'), {
                code: 4001,
              });
            }
            transactionCount += 1;
            const hash = `0x${transactionCount.toString(16).padStart(64, '0')}`;
            const request = (params?.[0] ?? {}) as Record<string, unknown>;
            transactions.set(hash, request);
            return hash;
          }
          if (method === 'eth_getTransactionByHash') {
            const hash = params?.[0] as string;
            const transaction = transactions.get(hash);
            if (!transaction) return null;
            return {
              hash,
              blockHash: `0x${'91'.repeat(32)}`,
              blockNumber: '0x1',
              transactionIndex: '0x0',
              from: approvedAccount,
              to: transaction.to,
              input: transaction.data ?? '0x',
              value: transaction.value ?? '0x0',
              nonce: '0x0',
              gas: '0x7a120',
              gasPrice: '0x1',
              type: '0x0',
              chainId,
              v: '0x1b',
              r: `0x${'01'.repeat(32)}`,
              s: `0x${'02'.repeat(32)}`,
            };
          }
          if (method === 'eth_getTransactionReceipt') {
            const hash = params?.[0] as string;
            const transaction = transactions.get(hash);
            if (!transaction) return null;
            return {
              transactionHash: hash,
              transactionIndex: '0x0',
              blockHash: `0x${'91'.repeat(32)}`,
              blockNumber: '0x1',
              from: approvedAccount,
              to: transaction.to,
              cumulativeGasUsed: '0x5208',
              gasUsed: '0x5208',
              contractAddress: null,
              logs: [],
              logsBloom: `0x${'00'.repeat(256)}`,
              status: '0x1',
              effectiveGasPrice: '0x1',
              type: '0x0',
            };
          }
          if (method === 'eth_blockNumber') return '0x2';
          if (method === 'eth_getTransactionCount') return '0x0';
          if (method === 'eth_estimateGas') return '0x7a120';
          if (method === 'eth_gasPrice') return '0x1';
          if (method === 'eth_maxPriorityFeePerGas') return '0x1';
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
    { approvedAccount: owner, signatures: signedMessages },
  );
}

async function mockDeviceRelay(
  page: Page,
  read: () => {
    schema: 'proofkey.device-handoff.v1';
    nonce: string;
    machineId: string;
    payer: string;
    orderId: string;
    sourceTransactionHash: string;
    accessExpiresAt: string;
    createdAt: string;
    expiresAt: string;
    claimedAt?: string;
    startReceipt?: { payload: UsageReceiptPayload; signature: string };
    endReceipt?: { payload: UsageReceiptPayload; signature: string };
  },
  write: (handoff: ReturnType<typeof read>) => void,
  claimToken: string,
) {
  await page.route('https://relay.invalid/**', async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const current = read();
    if (url.pathname.startsWith('/jobs/'))
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          sourceTransactionHash: current.sourceTransactionHash,
          phase: 'completed',
          orderId: current.orderId,
          machineId: current.machineId,
          payer: current.payer,
          accessExpiresAt: current.accessExpiresAt,
          creditcoinTransactionHash: `0x${'ab'.repeat(32)}`,
        }),
      });
    if (url.pathname === '/device-handoffs' && request.method() === 'POST')
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(current),
      });
    if (url.pathname.endsWith('/claim') && request.method() === 'POST') {
      if (current.claimedAt)
        return route.fulfill({
          status: 409,
          contentType: 'application/json',
          body: JSON.stringify({
            error: {
              message: 'This QR handoff was already claimed by a device.',
            },
          }),
        });
      const claimed = { ...current, claimedAt: new Date().toISOString() };
      write(claimed);
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ handoff: claimed, claimToken }),
      });
    }
    if (url.pathname.endsWith('/receipts') && request.method() === 'POST') {
      const receipt = request.postDataJSON() as {
        payload: UsageReceiptPayload;
        signature: string;
      };
      const next =
        receipt.payload.kind === 'start'
          ? { ...current, startReceipt: receipt }
          : { ...current, endReceipt: receipt };
      write(next);
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(next),
      });
    }
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(current),
    });
  });
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
