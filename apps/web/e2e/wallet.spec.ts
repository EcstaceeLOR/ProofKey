import { expect, test } from '@playwright/test';

const account = `0x${'12'.repeat(20)}`;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(
    ({ approvedAccount }) => {
      type Listener = (...arguments_: unknown[]) => void;
      const listeners = new Map<string, Set<Listener>>();
      let chainId = '0xaa36a7';

      const emit = (event: string, value: unknown) => {
        for (const listener of listeners.get(event) ?? []) listener(value);
      };
      const approved = () =>
        localStorage.getItem('wallet-fixture-approved') === 'yes';
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
            return approved() ? [approvedAccount] : [];
          if (method === 'eth_requestAccounts') {
            localStorage.setItem('wallet-fixture-approved', 'yes');
            localStorage.setItem(
              'wallet-fixture-request-count',
              String(
                Number(
                  localStorage.getItem('wallet-fixture-request-count') ?? '0',
                ) + 1,
              ),
            );
            queueMicrotask(() => emit('accountsChanged', [approvedAccount]));
            return [approvedAccount];
          }
          if (method === 'wallet_switchEthereumChain') {
            chainId = (params?.[0] as { chainId?: string })?.chainId ?? chainId;
            queueMicrotask(() => emit('chainChanged', chainId));
            return null;
          }
          if (method === 'wallet_addEthereumChain') return null;
          throw Object.assign(
            new Error(`Unsupported fixture method: ${method}`),
            { code: 4200 },
          );
        },
        on: (event: string, listener: Listener) => {
          const entries = listeners.get(event) ?? new Set<Listener>();
          entries.add(listener);
          listeners.set(event, entries);
        },
        removeListener: (event: string, listener: Listener) => {
          listeners.get(event)?.delete(listener);
        },
      };
      const detail = {
        info: {
          uuid: '350670db-19fa-4704-a166-e52e178b59d2',
          name: 'Playwright Wallet',
          icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
          rdns: 'io.proofkey.playwright',
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
    { approvedAccount: account },
  );
});

test('connects an EIP-6963 wallet and restores it without another prompt', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await expect(
    page.getByRole('dialog', { name: 'Choose a wallet' }),
  ).toBeVisible();
  await page.getByRole('button', { name: /Playwright Wallet/ }).click();
  await expect(page.getByRole('button', { name: /0x1212…1212/ })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem('wallet-fixture-request-count')),
    )
    .toBe('1');

  await page.reload();
  await expect(page.getByRole('button', { name: /0x1212…1212/ })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => localStorage.getItem('wallet-fixture-request-count')),
    )
    .toBe('1');
});

test('recovers an already connected wallet from the wrong network', async ({
  page,
}) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Connect wallet' }).click();
  await page.getByRole('button', { name: /Playwright Wallet/ }).click();
  await page.getByRole('button', { name: 'Close wallet dialog' }).click();
  await page.evaluate(async () => {
    await (
      window as Window & {
        ethereum: { request: (request: unknown) => Promise<unknown> };
      }
    ).ethereum.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x1' }],
    });
  });
  await expect(
    page.getByRole('button', { name: 'Switch chain 1' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Switch chain 1' }).click();
  await expect(
    page.getByRole('button', { name: 'Sepolia connected' }),
  ).toBeVisible();
});
