import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MachineController,
  deriveMachineState,
  type AuthorizationReader,
  type AuthorizationSnapshot,
  type MachineView,
} from './state.js';

const snapshot = (
  overrides: Partial<AuthorizationSnapshot> = {},
): AuthorizationSnapshot => ({
  authorized: false,
  authorizationId: `0x${'00'.repeat(32)}`,
  expiresAt: 0n,
  machineActive: true,
  blockNumber: 12_345,
  ...overrides,
});

test('machine begins locked before any Creditcoin result', () => {
  const views: MachineView[] = [];
  const reader: AuthorizationReader = { read: async () => snapshot() };
  const controller = new MachineController(reader, (view) => views.push(view));

  assert.equal(controller.current.state, 'locked');
  assert.equal(views[0]?.state, 'locked');
});

test('shows unlocking while the direct contract read is pending', async () => {
  let resolveRead: ((value: AuthorizationSnapshot) => void) | undefined;
  const reader: AuthorizationReader = {
    read: () => new Promise((resolve) => (resolveRead = resolve)),
  };
  const controller = new MachineController(
    reader,
    () => undefined,
    () => 100n,
  );

  const pending = controller.refresh();
  assert.equal(controller.current.state, 'unlocking');
  resolveRead?.(snapshot({ authorized: true, expiresAt: 200n }));
  await pending;
  assert.equal(controller.current.state, 'unlocked');
});

test('unlocks only when Creditcoin returns live authorization', () => {
  assert.equal(
    deriveMachineState(snapshot({ authorized: true, expiresAt: 200n }), 100n),
    'unlocked',
  );
  assert.equal(
    deriveMachineState(
      snapshot({ authorized: true, machineActive: false, expiresAt: 200n }),
      100n,
    ),
    'locked',
  );
});

test('a rejected or tampered proof result never unlocks the machine', () => {
  assert.equal(
    deriveMachineState(snapshot({ authorized: false, expiresAt: 200n }), 100n),
    'locked',
  );
});

test('returns to expired when the on-chain expiry is reached', async () => {
  let now = 100n;
  const reader: AuthorizationReader = {
    read: async () => snapshot({ authorized: true, expiresAt: 101n }),
  };
  const controller = new MachineController(
    reader,
    () => undefined,
    () => now,
  );
  await controller.refresh();
  assert.equal(controller.current.state, 'unlocked');

  now = 101n;
  controller.tick();
  assert.equal(controller.current.state, 'expired');
});

test('RPC failures lock the simulator instead of trusting cached access', async () => {
  let shouldFail = false;
  const reader: AuthorizationReader = {
    read: async () => {
      if (shouldFail) throw new Error('Creditcoin RPC unavailable');
      return snapshot({ authorized: true, expiresAt: 200n });
    },
  };
  const controller = new MachineController(
    reader,
    () => undefined,
    () => 100n,
  );
  await controller.refresh();
  assert.equal(controller.current.state, 'unlocked');

  shouldFail = true;
  await controller.refresh();
  assert.equal(controller.current.state, 'locked');
  assert.match(controller.current.error ?? '', /RPC unavailable/);
});
