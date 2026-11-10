'use strict';
// Application identity supplied by the project owner, not inferred from model pretraining.
const IDENTITY={name:'Rivora Assist',project:'Rivora',developer:'Nishan'};
const systemIdentity='You are Rivora Assist, the assistant in Rivora – Weather and Flood Risk Forecasting. Nishan developed Rivora and its assistant application. Never identify Alibaba Cloud or a language-model provider as the developer of Rivora. The underlying language model and its provider are separate from the authorship of this application. Do not invent Nishan\'s surname, contact details, qualifications or ownership claims.';
function identityAnswer(question){
 const q=String(question||'').trim();
 // Explicit questions about another model/vendor must not be rewritten as application authorship.
 const other=/\b(?:qwen|llama|gemini|chatgpt|alibaba|openai)\b/i.test(q)&&! /\b(?:rivora|you|your|this\s+(?:app|application|assistant|system))\b/i.test(q);
 if(other)return null;
 if(/\bwho\s+is\s+nishan\b/i.test(q))return 'Nishan is the developer of Rivora, the weather and flood-risk forecasting project, including the Rivora Assist application.';
 const authorship=/\b(?:who|whose)\b.*\b(?:developed|developer|built|created|creator|made|designed|programmed)\b|\b(?:who|what)\s+is\s+(?:the\s+)?(?:developer|creator)\b|\b(?:developer|creator)\s+of\s+(?:rivora|this|you)\b|\b(?:was|were|is|are)\b.*\b(?:rivora|you|this\s+(?:app|assistant|system))\b.*\b(?:developed|created|built|made)\s+by\b/i.test(q);
 if(authorship&&/\brivora\b|\byou\b|\byour\s+(?:developer|creator|app|application|assistant|system|project)\b|\bthis(?:\s+(?:project|app|application|assistant|system)\b|\s*[?.!]*$)/i.test(q))return 'Nishan developed Rivora and the Rivora Assist application. The underlying language-model provider is separate from the developer of Rivora.';
 if(/^(?:who\s+are\s+you|what(?:'s| is)\s+your\s+name|introduce\s+yourself|what\s+are\s+you)\s*[?.!]*$/i.test(q))return 'I’m Rivora Assist, the assistant for Rivora, developed by Nishan. I can help with general questions and check recorded weather, river conditions, forecasts and history.';
 return null;
}
function withIdentityPrompt(system){const text=String(system||'');return text.includes(systemIdentity)?text:systemIdentity+'\n'+text;}
// Verified application facts: package manifests, server routes and the saved ML policy.
const KNOWLEDGE={developer:IDENTITY.developer,architecture:'It uses a React frontend, an Express/Node.js backend and a MySQL database.',sources:'Its sources include KMA weather and rainfall, and WAMIS and HRFCO river observations and published warning evidence.',capabilities:'It supports river monitoring, recorded weather and rainfall, weather forecasts, historical observations, verified station-threshold comparisons and experimental 1h, 3h and 6h water-level forecasts.',limits:'Rivora is not an official flood-warning authority. Water-level predictions and threshold crossings are not flood probabilities. The shared official warning-issuance model failed independent validation; its probabilities remain unavailable. Missing or stale observations cannot establish safety.',accounts:'Email registration requires a click-enabled browser location to detect the nearest eligible gauge with verified coordinates, followed by email verification. Exact coordinates are not saved in preferences. Google and university sign-in require provider configuration. Saved monitoring preferences select the dashboard station. Official-warning emails require separate opt-in, verified email, exact verified station coverage and enabled delivery; proximity alone never establishes warning coverage. Unvalidated ML does not trigger official-style emails. Delivery is not guaranteed.',navigation:'Use Stations to find a gauge, River Monitoring for observations, Weather & Forecast for weather, Historical for records, ML Analysis for experimental level forecasts, and Alerts for alert information.'};
function projectAnswer(q){
 if(/registration|register|location.based.*alerts|email alerts|ML Analysis page|warning probabilities.*disabled/i.test(q))return /ML Analysis/i.test(q)?KNOWLEDGE.capabilities+' '+KNOWLEDGE.limits:/probabilit/i.test(q)?KNOWLEDGE.limits:KNOWLEDGE.accounts;
 if(/how.*flood.risk.*(?:work|calculat)|what does this dashboard do/i.test(q))return KNOWLEDGE.capabilities+' Verified station thresholds are compared with compatible observations; unknown coverage is not a statement of safety. '+KNOWLEDGE.limits;
 if(!/\brivora\b|this (?:app|project|system)|your (?:features|architecture|data sources)/i.test(q))return null;
 if(/can .*predict.*flood|flood.*predict/i.test(q))return 'Rivora provides experimental short-horizon water-level predictions and comparisons with verified station thresholds. These are not validated flood probabilities or issued warnings. The shared warning-issuance model failed independent validation, so official warning probabilities remain unavailable.';
 if(/architecture|react|express|mysql|built with|technology|tech stack/i.test(q))return KNOWLEDGE.architecture+' '+KNOWLEDGE.sources;
 if(/data source|where.*data|official sources/i.test(q))return KNOWLEDGE.sources+' Records retain their observation timestamps; unavailable data is not invented.';
 if(/email|authentication|sign.in|account/i.test(q))return KNOWLEDGE.accounts;
 if(/navigate|navigation|where.*(?:find|see|view)|which page/i.test(q))return KNOWLEDGE.navigation;
 if(/what is rivora|what does rivora|how (?:does|can) rivora (?:work|help)|features|capabilities/i.test(q))return 'Rivora is a weather and flood-risk monitoring project developed by Nishan. '+KNOWLEDGE.capabilities+' '+KNOWLEDGE.architecture+' '+KNOWLEDGE.limits;
 return null;
}
module.exports={IDENTITY,KNOWLEDGE,systemIdentity,identityAnswer,withIdentityPrompt,projectAnswer};
