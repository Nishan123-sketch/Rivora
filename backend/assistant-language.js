'use strict';
// Correct known domain typos only. Never fuzzy-rewrite names, IDs, dates or numbers.
const aliases={
 weatehr:'weather',weathr:'weather',wheather:'weather',weahter:'weather',weater:'weather',wether:'weather',
 forcast:'forecast',forecaste:'forecast',forcasting:'forecasting',
 tomorow:'tomorrow',tommorow:'tomorrow',tommorrow:'tomorrow',
 yestersays:'yesterday',yesterdays:'yesterday',yestarday:'yesterday',yestrday:'yesterday',yesturday:'yesterday',
 temprature:'temperature',temperture:'temperature',temperatur:'temperature',humidty:'humidity',rainfal:'rainfall',floood:'flood',forcasts:'forecasts',devloper:'developer',develper:'developer',devloped:'developed',creater:'creator'
};
function normalizeQuestion(value){return String(value||'').replace(/\b(yesterday|tomorrow)[’']s\b/gi,'$1').replace(/\b[a-z]+\b/gi,word=>aliases[word.toLowerCase()]||word);}
module.exports={normalizeQuestion};
