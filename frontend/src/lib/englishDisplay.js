import dictionary from '../../../shared/english-display.json' with {type:'json'};
import {romanizeKorean} from './riverEnglishNames.js';
export {englishStationName,englishRiverName,romanizeKorean} from './riverEnglishNames.js';
export function englishText(value){let text=String(value??'');for(const key of Object.keys(dictionary.phrases).sort((a,b)=>b.length-a.length))text=text.replaceAll(key,dictionary.phrases[key]);return /[가-힣]/.test(text)?romanizeKorean(text):text;}
export function englishBulletin(value){const raw=String(value||'');const match=raw.match(/(?:홍수예보|홍수특보)?\s*제?\s*\(?\s*(20\d{2})\s*-\s*(\d+)\s*\)?\s*호/);return match?(raw.includes('홍수특보')?'Flood Warning':'Flood Forecast')+' Bulletin No. '+match[1]+'-'+match[2]:englishText(raw);}
