import DataTable from './DataTable';
import {weatherColumns,waterColumns} from '../lib/table-columns';
export function Section({title,subtitle,children}) {return <section className="content-card"><div className="section-heading"><div><h3>{title}</h3>{subtitle&&<p>{subtitle}</p>}</div></div>{children}</section>}
export function StationPicker({stations,stationId,setStationId}) {return <label className="field-label">Monitoring station<select className="station-select" value={stationId} onChange={e=>setStationId(e.target.value)}><option value="all">All monitoring stations / Choose a station</option>{stations.map(s=><option key={s.station_id} value={String(s.station_id)}>{s.station_name} — {s.data_source}</option>)}</select></label>}
export function WeatherTable({rows}) {return <DataTable rows={rows} columns={weatherColumns} emptyMessage="No weather observations available for this selection."/>}
export function WaterTable({rows}) {return <><DataTable rows={rows} columns={waterColumns} emptyMessage="No water observations available for this selection."/><p className="disclaimer">K-water field meanings and units have not yet been verified. Do not use these readings to determine flood danger.</p></>}
export function Notice({children}) {return <p className="notice">{children}</p>}
export function PageTitle({children}) {return <div className="page-heading"><h2>{children}</h2></div>}
