import ObservationPlot from './ObservationPlot';
export default function HistoryChart(props){const unit=/\(mm\)/.test(props.label)?'mm':/\(m\)/.test(props.label)?'m':/score|estimate/i.test(props.label)?'score':'';return <ObservationPlot {...props} unit={unit}/>;}
