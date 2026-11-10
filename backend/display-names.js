// UI-only names. Never modify WAMIS names/IDs or claim romanizations are official translations.
const INITIAL = ['g','kk','n','d','tt','r','m','b','pp','s','ss','','j','jj','ch','k','t','p','h'];
const MEDIAL = ['a','ae','ya','yae','eo','e','yeo','ye','o','wa','wae','oe','yo','u','wo','we','wi','yu','eu','ui','i'];
const FINAL = ['', 'k','k','ks','n','nj','nh','t','l','lk','lm','lb','ls','lt','lp','lh','m','p','ps','t','t','ng','t','t','k','t','p','t'];

function romanizeKorean(text) {
  return [...String(text ?? '')].map(ch => {
    const cp = ch.charCodeAt(0) - 0xac00;
    if (cp < 0 || cp >= 11172) return ch;
    const initial = Math.floor(cp / 588);
    const medial = Math.floor((cp % 588) / 28);
    const final = cp % 28;
    return INITIAL[initial] + MEDIAL[medial] + FINAL[final];
  }).join('').replace(/\b[a-z]/g, c => c.toUpperCase());
}

const STATION_OVERRIDES = new Map([
  ['2201670', 'Taehwa Bridge'],
  ['1015640', 'Cheongpyeong Dam'],
  ['1001655', 'Jeongseon First Bridge'],
  ['1001683', 'Samok Bridge'],
  ['1001690', 'Yeongwol Bridge'],
  ['1018669', 'Changdong Bridge'],
  ['1023667', 'Jeonjin Bridge'],
  ['1101620', 'Geoncheon-ri'],
  ['4005645', 'Wolseok Bridge'],
  ['4008660', 'Moksadong First Bridge'],
  ['2301630', 'Tongcheon Bridge']
]);

function englishPart(text) {
  const raw = String(text || '').trim();
  if (!raw) return '';
  const county = raw.match(/^(.+)군$/u);
  if (county) return `${romanizeKorean(county[1])} County`;
  const city = raw.match(/^(.+)시$/u);
  if (city) return `${romanizeKorean(city[1])} City`;
  const bridge = raw.match(/^(.+?)(\d*)교$/u);
  if (bridge) return `${romanizeKorean(bridge[1])} Bridge${bridge[2] ? ` ${bridge[2]}` : ''}`;
  const dam = raw.match(/^(.+)댐$/u);
  if (dam) return `${romanizeKorean(dam[1])} Dam`;
  return romanizeKorean(raw);
}

function englishStationName(stationName, gaugeCode) {
  const override = STATION_OVERRIDES.get(String(gaugeCode ?? ''));
  if (override) return override;
  const raw = String(stationName || '').trim();
  if (!raw) return 'Unnamed gauge';
  const matched = raw.match(/^([^()（）]+)[(（]([^()（）]+)[)）]$/u);
  if (matched) {
    const place = englishPart(matched[1]);
    const facility = englishPart(matched[2]);
    return `${facility} (${place})`;
  }
  return englishPart(raw);
}

function englishRiverName(english, korean) {
  const name = String(english || korean || '').trim();
  if (!name) return 'Unknown river';
  return /[가-힣]/u.test(name) ? romanizeKorean(name) : name;
}

function englishBulletin(value){const raw=String(value||'');const match=raw.match(/(?:홍수예보|홍수특보)?\s*제?\s*\(?\s*(20\d{2})\s*-\s*(\d+)\s*\)?\s*호/);if(match)return (raw.includes('홍수특보')?'Flood Warning':'Flood Forecast')+' Bulletin No. '+match[1]+'-'+match[2];return englishText(raw);}
function englishText(value){let s=String(value??'');const phrases=require('../shared/english-display.json').phrases;for(const key of Object.keys(phrases).sort((a,b)=>b.length-a.length))s=s.replaceAll(key,phrases[key]);return /[가-힣]/.test(s)?romanizeKorean(s):s;}
module.exports={englishStationName,englishRiverName,romanizeKorean,englishBulletin,englishText};
