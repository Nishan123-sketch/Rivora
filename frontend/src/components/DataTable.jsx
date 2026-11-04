import {display} from '../lib/table-columns';
export default function DataTable({rows=[],columns,emptyMessage='No data available'}) {
 return <div className="table-wrapper"><table><thead><tr>{columns.map(c=><th key={c.key}>{c.title}</th>)}</tr></thead><tbody>{rows.length ? rows.map((r,i)=><tr key={`${r.station_id??'row'}-${i}`}>{columns.map(c=><td key={c.key}>{c.render ? c.render(r) : display(r[c.key])}</td>)}</tr>) : <tr><td colSpan={columns.length}>{emptyMessage}</td></tr>}</tbody></table></div>;
}
