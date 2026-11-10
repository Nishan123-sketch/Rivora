import {useEffect,useRef,useState} from 'react';
import {parseTime} from '../lib/time';
import {chartAxis} from '../lib/chartAxis';
const stamp=(t,long=false)=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Seoul',day:'2-digit',month:'short',...(long?{year:'numeric'}:{hour:'2-digit',minute:'2-digit',hour12:false})}).format(t);
export default function ObservationPlot({rows=[],field,label,unit='',color='#078998'}){
 const [hover,setHover]=useState(null);
 const plotRef=useRef(null);
 const points=rows.map(r=>({...r,t:parseTime(r.observed_at).getTime(),v:r[field]==null||r[field]===''?NaN:Number(r[field])})).filter(p=>Number.isFinite(p.t)&&Number.isFinite(p.v)).sort((a,b)=>a.t-b.t);
 useEffect(()=>{const root=plotRef.current,svg=root?.querySelector('svg');if(!svg)return;const resize=()=>root.style.setProperty('--plot-font-size',`${11*245/Math.max(1,svg.getBoundingClientRect().height)}px`);resize();const observer=new ResizeObserver(resize);observer.observe(svg);return()=>observer.disconnect();},[points.length]);
 if(!points.length)return <p className="chart-empty-message">No recorded values in this period.</p>;
 const start=points[0].t,end=points.at(-1).t,lo=Math.min(...points.map(p=>p.v)),hi=Math.max(...points.map(p=>p.v));
 const {min,max,ticks}=chartAxis(lo,hi,unit==='mm');
 const x=t=>65+(t-start)/Math.max(1,end-start)*865,y=v=>185-(v-min)/(max-min)*150;
 const daily=end-start>3*86400000,jumps=[];let d='';
 points.forEach((p,i)=>{const before=points[i-1],gap=before&&(p.t-before.t>(p.samples?2*86400000:3*3600000)||p.station_id!==before.station_id),jump=before&&Math.abs(p.v-before.v)>2&&field==='water_level';if(jump)jumps.push(p);d+=`${!i||gap||jump?'M':'L'}${x(p.t)},${y(p.v)} `;});
 const selected=hover===null?null:points[Math.min(hover,points.length-1)];
 return <div className="observation-plot" ref={plotRef}><div className="plot-summary"><span>{label}</span><span>Recorded range <b>{lo.toFixed(2)}–{hi.toFixed(2)} {unit}</b></span></div>
 <svg viewBox="0 0 1000 245" preserveAspectRatio="none" role="img" aria-label={`${label}. Horizontal axis: time in Korea. Vertical axis: ${unit||label}.`} onPointerMove={e=>{const box=e.currentTarget.getBoundingClientRect(),t=start+Math.max(0,Math.min(1,(e.clientX-box.left)/box.width*1000/865-65/865))*(end-start);let nearest=0;points.forEach((p,i)=>{if(Math.abs(p.t-t)<Math.abs(points[nearest].t-t))nearest=i;});setHover(nearest);}} onPointerLeave={()=>setHover(null)}>
 {ticks.map(v=><g key={v}><line x1="65" x2="930" y1={y(v)} y2={y(v)} stroke="#e3edf2" strokeDasharray="4 4"/><text x="55" y={y(v)+4} textAnchor="end">{v.toFixed(2)}</text></g>)}
 <text x="65" y="18">{unit||label}</text><path d={d} fill="none" stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke"/>
 {points.length===1&&<circle cx={x(points[0].t)} cy={y(points[0].v)} r="4" fill={color}/>}
 {[0,.25,.5,.75,1].map(f=><text key={f} x={65+865*f} y="210" textAnchor={f===0?'start':f===1?'end':'middle'}>{stamp(start+(end-start)*f,daily)}</text>)}
 <text x="500" y="237" textAnchor="middle">Date / time · Korea Standard Time (KST)</text>
 {jumps.map((p,i)=><circle key={i} cx={x(p.t)} cy={y(p.v)} r="4" fill="#d68b19"><title>Large recorded level change. Check gauge datum or source before interpreting.</title></circle>)}
 {selected&&<g><line x1={x(selected.t)} x2={x(selected.t)} y1="30" y2="185" stroke="#7c9aa9" strokeDasharray="3 4"/><circle cx={x(selected.t)} cy={y(selected.v)} r="4" fill={color}/></g>}
 </svg><div className="plot-readout" aria-live="polite">{selected?`${stamp(selected.t,true)} · ${stamp(selected.t)} KST · ${selected.v.toFixed(2)} ${unit}`:'Move over the line for the exact date, time and value.'}</div>
 {!!jumps.length&&<p className="plot-caution">Large recorded level change marked in amber. The line is broken there; verify the gauge reference or source before interpreting it.</p>}
 <details className="plot-values"><summary>View recorded values ({points.length})</summary><div><table><thead><tr><th>Time (KST)</th><th>{label}</th></tr></thead><tbody>{points.map((p,i)=><tr key={i}><td>{stamp(p.t,true)} · {stamp(p.t)}</td><td>{p.v.toFixed(2)} {unit}</td></tr>)}</tbody></table></div></details></div>;
}
