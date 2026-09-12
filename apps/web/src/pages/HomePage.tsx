import { ArrowRight, Boxes, KeyRound, ShieldCheck, Zap } from 'lucide-react';
import { Link } from 'react-router';
import { MachineArtwork, MachineCard } from '../components/ProductUI.js';
import { useMachineOffer, useRuntime } from '../app/AppProviders.js';
import { machinePath } from '../product.js';

export function Component() {
  const { config } = useRuntime();
  const offer = useMachineOffer();
  const machineId = config?.machineId ?? 'unconfigured';

  return (
    <div className="home-page">
      <section className="hero-panel">
        <div className="hero-content">
          <p className="eyebrow">
            <span className="live-dot" /> LIVE CROSS-CHAIN ACCESS NETWORK
          </p>
          <h1>
            Rent the machine.
            <br />
            <em>Carry the proof.</em>
          </h1>
          <p>
            Pay on Ethereum. Attestcoin proves it. Creditcoin turns that proof
            into time-bound access—without bridging funds or trusting a
            middleman.
          </p>
          <div className="hero-actions">
            <Link className="button primary large" to="/explore">
              Explore machines <ArrowRight size={18} />
            </Link>
            <Link className="text-link" to="/proofs/search">
              Inspect a proof <ShieldCheck size={16} />
            </Link>
          </div>
          <div className="hero-proofline">
            <span>
              <ShieldCheck size={15} /> 5 verified contracts
            </span>
            <span>
              <Zap size={15} /> 2-chain settlement
            </span>
            <span>
              <KeyRound size={15} /> 0 custodial keys
            </span>
          </div>
        </div>
        <div className="hero-machine">
          <MachineArtwork />
          <Link to={machinePath(machineId)} className="floating-machine-card">
            <span>FEATURED MACHINE</span>
            <strong>{config?.machineName ?? 'Industrial Excavator'}</strong>
            <small>
              {offer.data?.active
                ? 'Available now'
                : 'Checking live availability'}{' '}
              <ArrowRight size={13} />
            </small>
          </Link>
        </div>
      </section>

      <section
        className="protocol-stats"
        aria-label="ProofKey protocol statistics"
      >
        <div>
          <strong>01</strong>
          <span>Pay</span>
          <p>Settle usage directly with the machine owner on Sepolia.</p>
        </div>
        <div>
          <strong>02</strong>
          <span>Prove</span>
          <p>Attestcoin proves the canonical receipt across chains.</p>
        </div>
        <div>
          <strong>03</strong>
          <span>Unlock</span>
          <p>Creditcoin activates an expiring, non-transferable key.</p>
        </div>
        <div className="stat-emphasis">
          <Boxes size={24} />
          <span>
            One receipt.
            <br />
            No bridge.
          </span>
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <div>
            <p className="eyebrow">LIVE INVENTORY</p>
            <h2>Ready to work</h2>
          </div>
          <Link className="text-link" to="/explore">
            View network <ArrowRight size={16} />
          </Link>
        </div>
        <MachineCard
          machineId={machineId}
          name={config?.machineName ?? 'Industrial Excavator'}
          location={config?.machineLocation ?? 'Lagos Demo Yard · Bay 04'}
          offer={offer.data}
          loading={offer.isLoading}
        />
      </section>
    </div>
  );
}
