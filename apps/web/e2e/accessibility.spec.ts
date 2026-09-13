import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('homepage and wallet modal have no serious accessibility violations', async ({
  page,
}) => {
  await page.route('https://**.rpc.proofkey.invalid/**', (route) =>
    route.abort(),
  );
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const homepage = await new AxeBuilder({ page }).analyze();
  expect(
    homepage.violations.filter(({ impact }) =>
      ['serious', 'critical'].includes(impact ?? ''),
    ),
  ).toEqual([]);

  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Choose a wallet' }),
  ).toBeVisible();
  const dialog = await new AxeBuilder({ page })
    .include('.wallet-dialog')
    .analyze();
  expect(
    dialog.violations.filter(({ impact }) =>
      ['serious', 'critical'].includes(impact ?? ''),
    ),
  ).toEqual([]);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
});

test('primary navigation is keyboard-operable and mobile layout does not overflow', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('https://**.rpc.proofkey.invalid/**', (route) =>
    route.abort(),
  );
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: 'Open navigation' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveClass(
    /open/,
  );
  await page
    .getByRole('navigation', { name: 'Primary' })
    .getByRole('link', { name: 'System', exact: true })
    .focus();
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/diagnostics$/);
  const dimensions = await page.evaluate(() => ({
    width: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
  }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.width + 1);
});
