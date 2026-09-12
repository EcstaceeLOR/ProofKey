import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router';

export function Component() {
  return (
    <div className="not-found-page">
      <span>404 / OUTSIDE THE NETWORK</span>
      <strong>04</strong>
      <h1>This machine route doesn’t exist.</h1>
      <p>The requested page is not part of the ProofKey network.</p>
      <Link className="button primary" to="/explore">
        <ArrowLeft size={16} /> Return to Explore
      </Link>
    </div>
  );
}
