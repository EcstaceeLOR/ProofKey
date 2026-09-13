import catalog from './machine-catalog.json' with { type: 'json' };

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

export interface CatalogMachine extends MachineMetadata {
  label: string;
  tariff: string;
}

const machineCatalog = catalog.filter(isCatalogMachine) as CatalogMachine[];
if (machineCatalog.length !== catalog.length)
  throw new Error('The committed machine catalog contains invalid metadata.');

const metadataByUri = new Map<string, MachineMetadata>(
  machineCatalog.map(({ label: _label, tariff: _tariff, ...metadata }) => [
    metadata.uri,
    metadata,
  ]),
);

export function allMachineMetadata() {
  return [...metadataByUri.values()];
}

export function allCatalogMachines() {
  return [...machineCatalog];
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

function isCatalogMachine(value: unknown): value is CatalogMachine {
  const item = value as Partial<CatalogMachine> | undefined;
  return Boolean(
    isMachineMetadata(value) &&
    typeof item?.label === 'string' &&
    item.label.length > 0 &&
    typeof item.tariff === 'string' &&
    /^\d+$/.test(item.tariff) &&
    BigInt(item.tariff) > 0n,
  );
}
