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
