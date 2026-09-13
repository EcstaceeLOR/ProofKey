import {
  getAddress,
  isAddress,
  isHexString,
  keccak256,
  toUtf8Bytes,
  verifyMessage,
} from 'ethers';
import type {
  DeviceHandoff,
  SignedUsageReceipt,
  UsageReceiptPayload,
} from './types.js';

const sessionPattern = /^0x[0-9a-fA-F]{64}$/;
const noncePattern = /^[0-9a-fA-F]{64}$/;

export function usageReceiptMessage(payload: UsageReceiptPayload): string {
  return [
    'ProofKey Usage Receipt v1',
    `kind=${payload.kind}`,
    `sessionId=${payload.sessionId.toLowerCase()}`,
    `machineId=${payload.machineId.toLowerCase()}`,
    `payer=${payload.payer.toLowerCase()}`,
    `orderId=${payload.orderId.toLowerCase()}`,
    `nonce=${payload.nonce.toLowerCase()}`,
    `controller=${payload.controller.toLowerCase()}`,
    `startedAt=${payload.startedAt}`,
    `endedAt=${payload.endedAt ?? ''}`,
    `measuredDurationSeconds=${payload.measuredDurationSeconds}`,
    `accessExpiresAt=${payload.accessExpiresAt}`,
  ].join('\n');
}

export function assertUsageReceipt(
  handoff: DeviceHandoff,
  receipt: SignedUsageReceipt,
): void {
  const payload = receipt?.payload;
  if (
    !payload ||
    payload.schema !== 'proofkey.usage-receipt.v1' ||
    !['start', 'end'].includes(payload.kind) ||
    !sessionPattern.test(payload.sessionId) ||
    !isHexString(payload.machineId, 32) ||
    !isHexString(payload.orderId, 32) ||
    !noncePattern.test(payload.nonce) ||
    !isAddress(payload.payer) ||
    !isAddress(payload.controller) ||
    !Number.isSafeInteger(payload.measuredDurationSeconds) ||
    payload.measuredDurationSeconds < 0 ||
    !/^\d+$/.test(payload.accessExpiresAt) ||
    !isHexString(receipt.signature, 65)
  )
    throw new Error('Receipt shape or signature encoding is invalid.');

  if (
    payload.machineId.toLowerCase() !== handoff.machineId.toLowerCase() ||
    payload.orderId.toLowerCase() !== handoff.orderId.toLowerCase() ||
    payload.payer.toLowerCase() !== handoff.payer.toLowerCase() ||
    payload.nonce.toLowerCase() !== handoff.nonce.toLowerCase() ||
    payload.accessExpiresAt !== handoff.accessExpiresAt
  )
    throw new Error('Receipt does not match the claimed handoff.');
  const expectedSessionId = keccak256(
    toUtf8Bytes(`proofkey-device-session:${handoff.nonce}`),
  );
  if (payload.sessionId.toLowerCase() !== expectedSessionId.toLowerCase())
    throw new Error(
      'Receipt session ID is not derived from the handoff nonce.',
    );

  const startedAt = Date.parse(payload.startedAt);
  const endedAt = payload.endedAt ? Date.parse(payload.endedAt) : undefined;
  const accessExpiresAt = Number(payload.accessExpiresAt) * 1_000;
  if (!Number.isFinite(startedAt) || startedAt > accessExpiresAt)
    throw new Error('Receipt start time is invalid.');
  if (payload.kind === 'start') {
    if (payload.endedAt !== null || payload.measuredDurationSeconds !== 0)
      throw new Error('A start receipt cannot contain completed usage.');
  } else {
    if (!endedAt || endedAt < startedAt || endedAt > accessExpiresAt)
      throw new Error('Receipt end time is invalid.');
    const measured = Math.floor((endedAt - startedAt) / 1_000);
    if (measured !== payload.measuredDurationSeconds)
      throw new Error(
        'Measured duration does not match the receipt timestamps.',
      );
    const started = handoff.startReceipt?.payload;
    if (!started || started.startedAt !== payload.startedAt)
      throw new Error('End receipt is not bound to the stored start receipt.');
    if (
      started.sessionId.toLowerCase() !== payload.sessionId.toLowerCase() ||
      started.controller.toLowerCase() !== payload.controller.toLowerCase()
    )
      throw new Error('End receipt identity differs from the start receipt.');
  }

  let recovered: string;
  try {
    recovered = verifyMessage(usageReceiptMessage(payload), receipt.signature);
  } catch {
    throw new Error('Receipt signature recovery failed.');
  }
  if (getAddress(recovered) !== getAddress(payload.controller))
    throw new Error('Receipt signature is not from the declared controller.');
}
