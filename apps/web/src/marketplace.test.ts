import assert from 'node:assert/strict';
import test from 'node:test';
import {
  filterMarketplace,
  machineRegistryEvents,
  reconcileMarketplace,
  replayMachineLogs,
  replayOfferLogs,
  type ReplayLog,
} from './marketplace.js';

const machineId =
  '0xc04beae61beb9471c4f24c8788a4624988d2948a5c3d3dd0b6ba1b7602875bcc';
const ownerTopic =
  '0x0000000000000000000000001114eeafeb92b71babf860e64e4575433a734b6a';

const recordedCc3Registration: ReplayLog = {
  blockNumber: 5_476_982,
  transactionHash:
    '0x4b2f4a93ae2f6e9d57bf2386146ba3f7a7ce84033e76f82a2c7cb076809192aa',
  index: 0,
  topics: [
    '0x986cbf5e3020e941aeaa92bffac52f24650187bfc582c05c3bee4bb284f31d77',
    machineId,
    ownerTopic,
    ownerTopic,
  ],
  data: '0x24f58d3fcaa80aa0cbe4c88b0ce7d4a23312fa95ca201300a7313894970e883e00000000000000000000000000000000000000000000000000000000000009c40000000000000000000000000000000000000000000000000000000000000001',
};

const recordedSepoliaOffer: ReplayLog = {
  blockNumber: 11_691_319,
  transactionIndex: 85,
  transactionHash:
    '0x930a18d0a55f2a16153dbaf90a5719a47d97f1190db7f13ebd371a3fcc63c369',
  index: 238,
  topics: [
    '0x7fe5f9ca822b5223f722e4b037ac183e3131d3747c2c4d537baf6b51448ce923',
    machineId,
    ownerTopic,
  ],
  data: '0x00000000000000000000000000000000000000000000000000000000000009c40000000000000000000000000000000000000000000000000000000000000001',
};

test('replays recorded CC3 and Sepolia logs into an available marketplace listing', () => {
  const machines = replayMachineLogs([recordedCc3Registration]);
  const offers = replayOfferLogs([recordedSepoliaOffer]);
  const [listing] = reconcileMarketplace(machines, offers, {
    address: '0x0000000000000000000000000000000000000001',
    decimals: 6,
    symbol: 'USDC',
  });
  assert.equal(listing?.machineId, machineId);
  assert.equal(listing?.metadata?.name, 'Industrial Excavator');
  assert.equal(listing?.metadataValid, true);
  assert.equal(listing?.synchronized, true);
  assert.equal(listing?.status, 'available');
});

test('deterministic replay applies updates by chain position and rejects invalid metadata', () => {
  const updated = machineRegistryEvents.encodeEventLog(
    machineRegistryEvents.getEvent('MachineMetadataUpdated')!,
    [machineId, `0x${'ff'.repeat(32)}`],
  );
  const machines = replayMachineLogs([
    { ...recordedCc3Registration, blockNumber: 20 },
    {
      blockNumber: 21,
      transactionHash: `0x${'11'.repeat(32)}`,
      index: 0,
      topics: updated.topics,
      data: updated.data,
    },
  ]);
  const [listing] = reconcileMarketplace(
    machines,
    replayOfferLogs([recordedSepoliaOffer]),
    {
      address: '0x0000000000000000000000000000000000000001',
      decimals: 6,
      symbol: 'USDC',
    },
  );
  assert.equal(listing?.metadataValid, false);
  assert.equal(listing?.status, 'metadata-invalid');
});

test('filters, sorts, and paginates marketplace results', () => {
  const listings = reconcileMarketplace(
    replayMachineLogs([recordedCc3Registration]),
    replayOfferLogs([recordedSepoliaOffer]),
    {
      address: '0x0000000000000000000000000000000000000001',
      decimals: 6,
      symbol: 'USDC',
    },
  );
  const result = filterMarketplace(listings, {
    query: 'Lagos',
    category: 'Construction',
    location: 'Lagos',
    availability: 'available',
    sort: 'price-asc',
    page: 1,
    pageSize: 1,
  });
  assert.equal(result.total, 1);
  assert.equal(result.items[0]?.machineId, machineId);
  assert.equal(result.totalPages, 1);
});
