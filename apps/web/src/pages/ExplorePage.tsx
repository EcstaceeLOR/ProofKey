import { Filter, Search, SlidersHorizontal } from 'lucide-react';
import { useSearchParams } from 'react-router';
import { useMarketplace, useRuntime } from '../app/AppProviders.js';
import {
  DataState,
  MachineCard,
  PageHeading,
} from '../components/ProductUI.js';
import { filterMarketplace, type MarketplaceFilters } from '../marketplace.js';

export function Component() {
  const { configurationError } = useRuntime();
  const marketplace = useMarketplace();
  const [params, setParams] = useSearchParams();
  const filters: MarketplaceFilters = {
    query: params.get('q') ?? '',
    category: params.get('category') ?? '',
    location: params.get('location') ?? '',
    availability: params.get('status') ?? '',
    sort: (params.get('sort') as MarketplaceFilters['sort']) ?? 'availability',
    page: Number(params.get('page') ?? 1) || 1,
    pageSize: 6,
  };
  const result = filterMarketplace(marketplace.data?.machines ?? [], filters);
  const categories = [
    ...new Set(
      marketplace.data?.machines
        .map((item) => item.metadata?.category)
        .filter(Boolean) as string[],
    ),
  ];
  const locations = [
    ...new Set(
      marketplace.data?.machines
        .map((item) => item.metadata?.location.city)
        .filter(Boolean) as string[],
    ),
  ];
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    value ? next.set(key, value) : next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  return (
    <div className="route-page">
      <PageHeading
        eyebrow="ON-CHAIN MARKETPLACE / CC3 + SEPOLIA"
        title="Explore real-world capacity."
        copy="Listings are discovered from Creditcoin events, hydrated from live contracts, and reconciled with their Sepolia payment offers."
        action={
          <div className="result-count">
            <strong>{String(result.total).padStart(2, '0')}</strong>
            <span>machines found</span>
          </div>
        }
      />

      <section className="explore-toolbar" aria-label="Machine filters">
        <label className="search-field">
          <Search size={18} />
          <input
            value={filters.query}
            onChange={(event) => update('q', event.target.value)}
            placeholder="Search machine, capability or location"
          />
        </label>
        <FilterSelect
          icon={<Filter size={16} />}
          label="Category"
          value={filters.category}
          onChange={(value) => update('category', value)}
          options={categories}
          all="All categories"
        />
        <FilterSelect
          icon={<Filter size={16} />}
          label="Location"
          value={filters.location}
          onChange={(value) => update('location', value)}
          options={locations}
          all="All locations"
        />
        <FilterSelect
          icon={<SlidersHorizontal size={16} />}
          label="Availability"
          value={filters.availability}
          onChange={(value) => update('status', value)}
          all="Every status"
          options={[
            'available',
            'inactive',
            'unsynchronized',
            'metadata-invalid',
          ]}
        />
        <FilterSelect
          icon={<SlidersHorizontal size={16} />}
          label="Sort"
          value={filters.sort}
          onChange={(value) => update('sort', value)}
          all="Available first"
          options={['price-asc', 'price-desc', 'newest']}
        />
      </section>

      {configurationError ? (
        <DataState
          kind="error"
          title="Machine network is not configured"
          copy={configurationError}
        />
      ) : marketplace.isLoading ? (
        <div className="catalog-grid" aria-label="Loading marketplace">
          {[0, 1, 2].map((item) => (
            <div className="catalog-skeleton" key={item} />
          ))}
        </div>
      ) : marketplace.isError ? (
        <DataState
          kind="offline"
          title="Could not index both networks"
          copy="ProofKey could not reconcile the Creditcoin registry and Sepolia offers. No unverified listing was presented."
          action={
            <button
              className="button secondary"
              type="button"
              onClick={() => void marketplace.refetch()}
            >
              Retry indexing
            </button>
          }
        />
      ) : result.items.length ? (
        <>
          <div className="marketplace-sync">
            <span>
              CC3 block {marketplace.data?.creditcoinBlock.toLocaleString()}
            </span>
            <span>
              Sepolia block {marketplace.data?.sepoliaBlock.toLocaleString()}
            </span>
          </div>
          <div className="catalog-grid">
            {result.items.map((machine) => (
              <MachineCard key={machine.machineId} machine={machine} />
            ))}
          </div>
          {result.totalPages > 1 && (
            <nav className="pagination" aria-label="Marketplace pages">
              <button
                type="button"
                disabled={result.page === 1}
                onClick={() => update('page', String(result.page - 1))}
              >
                Previous
              </button>
              <span>
                Page {result.page} of {result.totalPages}
              </span>
              <button
                type="button"
                disabled={result.page === result.totalPages}
                onClick={() => update('page', String(result.page + 1))}
              >
                Next
              </button>
            </nav>
          )}
        </>
      ) : (
        <DataState
          kind="empty"
          title="No machines match these filters"
          copy="Clear one or more filters to return to the indexed Creditcoin inventory."
          action={
            <button
              type="button"
              className="button secondary"
              onClick={() => setParams({}, { replace: true })}
            >
              Clear filters
            </button>
          }
        />
      )}
    </div>
  );
}

function FilterSelect({
  icon,
  label,
  value,
  onChange,
  options,
  all,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  all: string;
}) {
  const labels: Record<string, string> = {
    available: 'Available',
    inactive: 'Inactive',
    unsynchronized: 'Unsynchronized',
    'metadata-invalid': 'Invalid metadata',
    'price-asc': 'Price: low to high',
    'price-desc': 'Price: high to low',
    newest: 'Newest registration',
  };
  return (
    <label className="filter-select">
      {icon}
      <select
        aria-label={label}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">{all}</option>
        {options.map((item) => (
          <option key={item} value={item}>
            {labels[item] ?? item}
          </option>
        ))}
      </select>
    </label>
  );
}
