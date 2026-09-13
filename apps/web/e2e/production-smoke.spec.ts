import { expect, test } from '@playwright/test';

const machineId =
  process.env.PRODUCTION_MACHINE_ID ??
  '0xc04beae61beb9471c4f24c8788a4624988d2948a5c3d3dd0b6ba1b7602875bcc';
const proofTransaction =
  process.env.PRODUCTION_PROOF_TRANSACTION ??
  '0xb646bed97cd5ecafec256ea121a3ab7b5d147cce9c38e9e8f5f96cccfd17b967';
const relayUrl =
  process.env.PRODUCTION_RELAY_URL ?? 'https://proofkey-relay.onrender.com';

test('deployed product routes, assets, wallet modal, and relay are live', async ({
  page,
  request,
}) => {
  const failedAssets: string[] = [];
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (
      url.origin === new URL(process.env.PRODUCTION_WEB_URL!).origin &&
      ['document', 'script', 'stylesheet', 'font', 'image'].includes(
        response.request().resourceType(),
      ) &&
      response.status() >= 400
    )
      failedAssets.push(`${response.status()} ${url.pathname}`);
  });

  const home = await page.goto('/', { waitUntil: 'domcontentloaded' });
  expect(home?.status()).toBe(200);
  await expect(page.getByRole('link', { name: 'ProofKey home' })).toBeVisible();
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Choose a wallet' }),
  ).toBeVisible();
  await page.keyboard.press('Escape');

  const machine = await page.goto(`/machines/${machineId}`, {
    waitUntil: 'domcontentloaded',
  });
  expect(machine?.status()).toBe(200);
  await expect(
    page.locator('main h1, main [role="alert"] h2').first(),
  ).toBeVisible();

  const proof = await page.goto(`/proofs/${proofTransaction}`, {
    waitUntil: 'domcontentloaded',
  });
  expect(proof?.status()).toBe(200);
  await expect(
    page.locator('main h1, main [role="alert"] h2').first(),
  ).toBeVisible();

  const health = await request.get(`${relayUrl}/health`, { timeout: 60_000 });
  expect(health.status()).toBe(200);
  expect((await health.json()).status).toBe('alive');
  expect(failedAssets).toEqual([]);

  const firstContentfulPaint = await page.evaluate(
    () =>
      performance
        .getEntriesByType('paint')
        .find((entry) => entry.name === 'first-contentful-paint')?.startTime,
  );
  if (firstContentfulPaint !== undefined)
    expect(firstContentfulPaint).toBeLessThan(5_000);
});
