// Shared live river selector and careful gauge-specific risk assessment.
// No automatic classifications from unverified stage thresholds.
import RiverMonitoring from './RiverMonitoring';
export default function RiskAnalysis(props) {
  return <RiverMonitoring {...props} mode="risk"/>;
}
