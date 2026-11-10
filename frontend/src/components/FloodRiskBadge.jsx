import {floodRiskPresentation} from '../lib/floodRiskPresentation';
import '../styles/flood-risk-badge.css';

// The main dashboard stays concise: grade + source only.
// Full evidence and evaluation limitations are in FLOOD_RISK_METHOD_REPORT.md.
export default function FloodRiskBadge({result}) {
  const status = result || floodRiskPresentation();
  const key = status.grade ? status.grade.toLowerCase() : 'none';
  return <span className={`flood-risk-pill flood-risk-pill--${key}`} role="status" title={status.reason}>
    <span className="flood-risk-pill__label"><span className="flood-risk-pill__dot" aria-hidden="true"/>{status.label}</span>
    {status.method && <span className="flood-risk-pill__method">{status.method}</span>}
  </span>;
}
