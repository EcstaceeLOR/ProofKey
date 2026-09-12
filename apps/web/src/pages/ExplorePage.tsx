import { Filter, Search, SlidersHorizontal } from 'lucide-react';
import { useState } from 'react';
import { useMachineOffer, useRuntime } from '../app/AppProviders.js';
import {
  DataState,
  MachineCard,
  PageHeading,
} from '../components/ProductUI.js';

export function Component() {
  const { config, configurationError } = useRuntime();
  const offer = useMachineOffer();
  const [query, setQuery] = useState('');
  const name = config?.machineName ?? 'Industrial Excavator';
  const location = config?.machineLocation ?? 'Lagos Demo Yard · Bay 04';
  const visible = `${name} ${location}`
    .toLowerCase()
    .includes(query.toLowerCase());

  return (
    <div className="route-page">
      <PageHeading
        eyebrow="MACHINE NETWORK / CC3"
        title="Explore real-world capacity."
        copy="Every listing is reconciled against Creditcoin machine policy and its corresponding Sepolia payment offer before it can accept a rental."
        action={
          <div className="result-count">
            <strong>{visible && config ? '01' : '00'}</strong>
            <span>live machines</span>
          </div>
        }
      />

      <section className="explore-toolbar" aria-label="Machine filters">
        <label className="search-field">
          <Search size={18} />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search machine or location"
          />
        </label>
        <button type="button" className="filter-button">
          <Filter size={16} /> Industrial
        </button>
        <button type="button" className="filter-button">
          <SlidersHorizontal size={16} /> Available first
        </button>
      </section>

      {configurationError ? (
        <DataState
          kind="error"
          title="Machine network is not configured"
          copy={configurationError}
        />
      ) : offer.isError ? (
        <DataState
          kind="offline"
          title="Could not reach both networks"
          copy="ProofKey failed closed because the Sepolia offer and Creditcoin machine could not be reconciled."
          action={
            <button
              className="button secondary"
              type="button"
              onClick={() => void offer.refetch()}
            >
              Retry
            </button>
          }
        />
      ) : visible && config ? (
        <div className="catalog-grid">
          <MachineCard
            machineId={config.machineId}
            name={name}
            location={location}
            offer={offer.data}
            loading={offer.isLoading}
          />
        </div>
      ) : (
        <DataState
          kind="empty"
          title="No machines match that search"
          copy="Clear the search to return to the live Creditcoin inventory."
        />
      )}
    </div>
  );
}
