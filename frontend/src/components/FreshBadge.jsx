// Small Fresh / Stale / No data badge for stations and cards.
export default function FreshBadge({status}){
  const s=String(status||'').toLowerCase();
  const cls=s==='fresh'?'':s==='stale'?' stale':' none';
  const text=s==='fresh'?'Fresh':s==='stale'?'Stale':'No data';
  return <span className={'fresh-badge'+cls}>{text}</span>
}
