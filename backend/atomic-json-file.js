'use strict';
const fs=require('fs'),path=require('path'),crypto=require('crypto');
function writeJson(file,value,{rename=fs.renameSync,wait=ms=>Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,ms)}={}){
 const encoded=JSON.stringify(value,null,2);fs.mkdirSync(path.dirname(file),{recursive:true});
 const temp=file+'.'+process.pid+'.'+crypto.randomUUID()+'.tmp';
 try{fs.writeFileSync(temp,encoded);for(let attempt=0;attempt<6;attempt++)try{rename(temp,file);return;}catch(error){if(!['EACCES','EPERM','EBUSY'].includes(error.code)||attempt===5)throw error;wait(25*2**attempt);}}
 finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}
module.exports={writeJson};
