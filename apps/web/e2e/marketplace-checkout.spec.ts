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

async function mockMarketplaceRpc(page: Page) {
  await page.route('https://**.rpc.proofkey.invalid/**', async (route) => {
    const request = route.request();
    const payload = request.postDataJSON() as RpcRequest | RpcRequest[];
    const isCreditcoin = request.url().includes('creditcoin');
    const requests = Array.isArray(payload) ? payload : [payload];
    const responses = requests.map((rpc) => ({
      jsonrpc: '2.0',
      id: rpc.id,
      result: rpcResult(rpc, isCreditcoin),
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

function rpcResult(rpc: RpcRequest, isCreditcoin: boolean) {
  let result: unknown;
  if (rpc.method === 'eth_chainId')
    result = isCreditcoin ? '0x18e8f' : '0xaa36a7';
  else if (rpc.method === 'eth_blockNumber')
    result = isCreditcoin ? '0x539000' : '0xb26c00';
  else if (rpc.method === 'eth_getLogs') {
    const topics = (rpc.params?.[0] as { topics?: unknown[] })?.topics ?? [];
    const isUsageQuery = topics.length > 1 && topics[1] === null;
    result = isUsageQuery
      ? []
      : isCreditcoin
        ? [cc3Registration()]
        : [sepoliaOffer()];
  } else if (rpc.method === 'eth_call') {
    const call = rpc.params?.[0] as { to: string; data: string };
    const target = call.to.toLowerCase();
    if (target.endsWith('02'))
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
