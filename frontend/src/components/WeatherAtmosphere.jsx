export default function WeatherAtmosphere({condition='neutral',breeze=false}){
 return <div className={`weather-atmosphere weather-atmosphere--${condition}${breeze?' atmosphere-breeze':''}`} aria-hidden="true">
  <div className="atmosphere-cloud cloud-one"><svg viewBox="0 0 180 65"><path d="M25 58C-4 58 0 23 27 25 34-7 82-6 91 22c28-12 53 1 53 17 36-3 40 19 10 19Z"/></svg></div>
  <div className="atmosphere-cloud cloud-two"><svg viewBox="0 0 180 65"><path d="M25 58C-4 58 0 23 27 25 34-7 82-6 91 22c28-12 53 1 53 17 36-3 40 19 10 19Z"/></svg></div>
  {condition==='rain'&&<div className="atmosphere-rain">{Array.from({length:12},(_,i)=><i key={i} style={{left:`${8+i*7.5}%`,animationDelay:`${-i*.31}s`,animationDuration:`${1.7+(i%3)*.3}s`}}/>)}</div>}
  <svg className="atmosphere-river river-back" viewBox="0 0 1200 120" preserveAspectRatio="none"><path d="M0 50Q150 5 300 50T600 50T900 50T1200 50V120H0Z"/></svg>
  <svg className="atmosphere-river river-middle" viewBox="0 0 1200 120" preserveAspectRatio="none"><path d="M0 65Q150 25 300 65T600 65T900 65T1200 65V120H0Z"/></svg>
  <svg className="atmosphere-river river-front" viewBox="0 0 1200 120" preserveAspectRatio="none"><path d="M0 80Q150 48 300 80T600 80T900 80T1200 80V120H0Z"/></svg>
  <div className="atmosphere-reflection"/>
 </div>;
}
