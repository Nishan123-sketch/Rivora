function finalText(text){
 let value=String(text||'').replace(/<think>[\s\S]*?<\/think>/gi,'').trim();
 const start=value.search(/<think>/i);if(start>=0)value=value.slice(0,start).trim();
 return value.replace(/^\s*<\/think>\s*/i,'').trim();
}
module.exports={finalText};
