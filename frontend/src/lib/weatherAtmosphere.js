const number=v=>v==null||v===''||!Number.isFinite(Number(v))?null:Number(v);
export function weatherAtmosphere(observation,details){
 // Weekly condition codes are forecasts from a separate provider, not KMA observations.
 // Zero rain cannot establish clear skies; the current API supplies no observed sky code.
 const aws=details.awsIsFresh?number(observation?.aws_hourly_rainfall):null;
 const hourly=details.observationIsFresh?number(observation?.hourly_rainfall):null;
 const rain=(aws!==null&&aws>0)||(hourly!==null&&hourly>0);
 const speed=details.observationIsFresh&&details.windSource==='observed'?number(observation?.wind_speed):null;
 return {condition:rain?'rain':'neutral',breeze:speed!==null&&speed>0};
}
