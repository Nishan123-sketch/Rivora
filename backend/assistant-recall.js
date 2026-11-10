// Recall only explicit declarations in this submitted conversation, never account records.
function recall(question,messages=[]){
 const nameQuestion=/what(?:'s| is) my name|remember my name/i.test(question),projectQuestion=/what project|which project|what am i working on/i.test(question);
 if(!nameQuestion&&!projectQuestion)return null;
 let name=null,project=null;
 for(const m of messages.filter(m=>m.role==='user')){
  const declaration=m.content.match(/\bmy name is\s+(.{1,100})/iu);
  const n=declaration?.[1].match(/^([\p{L}][\p{L}'-]*(?:\s+[A-Z][\p{L}'-]*)?)/u);
  const p=m.content.match(/\bmy project is\s+([\p{L}\p{N}][\p{L}\p{N} '-]{0,60})(?:[.!?\n]|$)/iu);
  if(n)name=n[1];if(p)project=p[1].trim();
 }
 const parts=[];if(nameQuestion)parts.push(name?`You told me your name is ${name}.`:'I don’t have your name in the recent messages.');
 if(projectQuestion)parts.push(project?`You told me your project is ${project}.`:'I don’t have a project name in the recent messages.');
 return parts.join(' ');
}
module.exports={recall};
