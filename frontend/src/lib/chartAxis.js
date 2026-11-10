export function chartAxis(low,high,nonnegative=false){
 const spread=Math.max(high-low,.1),padding=spread*.12,lower=nonnegative?Math.max(0,low-padding):low-padding,upper=high+padding;
 const raw=(upper-lower)/4,power=10**Math.floor(Math.log10(raw)),step=[1,2,5,10].find(n=>n*power>=raw)*power;
 const min=nonnegative?Math.max(0,Math.floor(lower/step)*step):Math.floor(lower/step)*step,max=Math.ceil(upper/step)*step;
 const ticks=Array.from({length:Math.round((max-min)/step)+1},(_,i)=>min+i*step);
 return {min,max,ticks};
}
