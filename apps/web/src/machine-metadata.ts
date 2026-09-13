export interface MachineMetadata {
  uri: string;
  name: string;
  description: string;
  image: string;
  category: string;
  location: { city: string; country: string; site: string };
  capabilities: string[];
  safetyRequirements: string[];
  operator: { name: string; wallet: string; verified: boolean };
}

const metadataByUri = new Map<string, MachineMetadata>([
  [
    'ipfs://proofkey/excavator/001',
    {
      uri: 'ipfs://proofkey/excavator/001',
      name: 'Industrial Excavator',
      description:
        'A proof-gated hydraulic excavator for earthmoving and site preparation.',
      image: 'excavator',
      category: 'Construction',
      location: {
        city: 'Lagos',
        country: 'Nigeria',
        site: 'Demo Yard · Bay 04',
      },
      capabilities: [
        '22-ton operating capacity',
        'GPS telemetry',
        'Remote access controller',
      ],
      safetyRequirements: [
        'Verified operator briefing',
        'Hard hat and high-visibility vest',
      ],
      operator: {
        name: 'ProofKey Industrial',
        wallet: '0x1114eeafeb92b71babf860e64e4575433a734b6a',
        verified: true,
      },
    },
  ],
]);

export function allMachineMetadata() {
  return [...metadataByUri.values()];
}

export function isMachineMetadata(value: unknown): value is MachineMetadata {
  const item = value as Partial<MachineMetadata> | undefined;
  return Boolean(
    item &&
    typeof item.uri === 'string' &&
    typeof item.name === 'string' &&
    typeof item.description === 'string' &&
    typeof item.image === 'string' &&
    typeof item.category === 'string' &&
    item.location &&
    typeof item.location.city === 'string' &&
    typeof item.location.country === 'string' &&
    typeof item.location.site === 'string' &&
    Array.isArray(item.capabilities) &&
    item.capabilities.every((entry) => typeof entry === 'string') &&
    Array.isArray(item.safetyRequirements) &&
    item.safetyRequirements.every((entry) => typeof entry === 'string') &&
    item.operator &&
    typeof item.operator.name === 'string' &&
    typeof item.operator.wallet === 'string' &&
    typeof item.operator.verified === 'boolean',
  );
}
