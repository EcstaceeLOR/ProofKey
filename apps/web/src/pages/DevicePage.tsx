import {
  ExternalLink,
  KeyRound,
  LockKeyhole,
  QrCode,
  RadioTower,
} from 'lucide-react';
import { Link, useParams } from 'react-router';
import { useMachineOffer, useRuntime } from '../app/AppProviders.js';
import { DataState, PageHeading } from '../components/ProductUI.js';
import { compactHash } from '../product.js';

export function Component() {
  const { machineId = '' } = useParams();
  const { config, account } = useRuntime();
  const offer = useMachineOffer();
  if (!config || machineId.toLowerCase() !== config.machineId.toLowerCase())
    return (
      <div className="route-page">
        <DataState
          kind="empty"
          title="Device not found"
          copy="Open a device from a registered machine page."
        />
      </div>
    );

  return (
    <div className="route-page device-page">
      <PageHeading
        eyebrow="MACHINE ACCESS TERMINAL"
        title="The chain decides whether this machine opens."
        copy="This handoff surface identifies the renter and machine; the device remains locked until it independently confirms an active AccessPass on Creditcoin."
      />
      <section className="device-console">
        <div className="device-lock">
          <div className="lock-rings">
            <span />
            <span />
            <div>
              <LockKeyhole size={42} />
            </div>
          </div>
          <span className="device-state">AWAITING VERIFIED ACCESS</span>
          <h2>{config.machineName}</h2>
          <p>
            {account
              ? `Checking access for ${compactHash(account, 8, 6)}`
              : 'Connect the renter wallet to prepare a device handoff.'}
          </p>
        </div>
        <div className="device-readout">
          <div>
            <span>
              <RadioTower size={15} /> Network
            </span>
            <strong>Creditcoin CC3</strong>
          </div>
          <div>
            <span>
              <KeyRound size={15} /> Authorization
            </span>
            <strong>AccessPass.isAuthorized</strong>
          </div>
          <div>
            <span>
              <QrCode size={15} /> Machine ID
            </span>
            <code>{compactHash(config.machineId, 12, 10)}</code>
          </div>
          <div>
            <span>Machine status</span>
            <strong>
              {offer.isLoading
                ? 'Checking…'
                : offer.data?.active
                  ? 'Active'
                  : 'Inactive · locked'}
            </strong>
          </div>
          <a
            className="button primary wide"
            href={config.deviceUrl}
            target="_blank"
            rel="noreferrer"
          >
            Open independent device client <ExternalLink size={15} />
          </a>
          <Link
            className="text-link centered"
            to={`/machines/${config.machineId}`}
          >
            Return to machine details
          </Link>
        </div>
      </section>
    </div>
  );
}
