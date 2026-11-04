import {riskColors,NO_DATA_COLOR} from '../lib/risk';
// Always shows a text label next to the colour so risk never depends on colour alone.
export default function RiskLight({level,label}){
  const known=Object.prototype.hasOwnProperty.call(riskColors,level);
  return <span className="risk-light"><i aria-hidden="true" className={'risk-dot '+(known?level.toLowerCase():'none')} style={{background:known?riskColors[level]:NO_DATA_COLOR}}/>{label||level||'No risk data'}</span>
}
