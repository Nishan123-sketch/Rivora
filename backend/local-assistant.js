const path=require('path'),fs=require('fs'),net=require('net');let child=null,pending=null,lastLaunch=0,startupState={reason:'MODEL_NOT_RUNNING',retryable:true};
function bounded(value,fallback,min,max){const n=Number(value);return Number.isInteger(n)&&n>=min&&n<=max?n:fallback;}
function localAddress(env=process.env){const u=new URL(env.LLM_LOCAL_BASE_URL||'http://127.0.0.1:11434');if(u.protocol!=='http:'||!['127.0.0.1','localhost','[::1]'].includes(u.hostname)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw Error('Invalid private local-model address');return `http://127.0.0.1:${u.port||80}`;}
function launchConfig(env=process.env,exists=fs.existsSync){
 const folder=path.join(__dirname,'../.local');const upgraded=exists(path.join(folder,'assistant-upgrade-active.json'))&&exists(path.join(folder,'llama-cuda/llama-server.exe'))&&exists(path.join(folder,'models/Qwen3-4B-Q4_K_M.gguf'));
 const exe=env.LLM_LOCAL_EXECUTABLE||path.join(folder,upgraded?'llama-cuda/llama-server.exe':'ollama/lib/ollama/llama-server.exe');
 const model=env.LLM_LOCAL_MODEL_PATH||path.join(folder,upgraded?'models/Qwen3-4B-Q4_K_M.gguf':'models/llama3.2-1b.gguf');
 return {folder,exe,model,args:['-m',model,'--host','127.0.0.1','--port',new URL(localAddress(env)).port||'80',...(/Qwen3/i.test(model)?['--reasoning','off']:[]),'-c',String(bounded(env.LLM_LOCAL_CONTEXT,4096,1024,8192)),'-t',String(bounded(env.LLM_LOCAL_THREADS,4,1,16)),...(bounded(env.LLM_GPU_LAYERS,upgraded?28:0,0,99)===0?['--device','none']:[]),'--no-repack','-b','256','-ub','64','-np','1','-ngl',String(bounded(env.LLM_GPU_LAYERS,upgraded?28:0,0,99))]};
}
async function launchLocalAssistant(){
 if(process.env.LLM_PROVIDER!=='llamacpp')return;
 const reachable=await new Promise(resolve=>{const socket=net.createConnection({host:'127.0.0.1',port:Number(new URL(localAddress()).port)||80});const done=value=>{socket.destroy();resolve(value)};socket.once('connect',()=>done(true));socket.once('error',()=>done(false));socket.setTimeout(1500,()=>done(false));});if(reachable)return;
 const config=launchConfig();if(!fs.existsSync(config.exe)||!fs.existsSync(config.model)){startupState={reason:'MODEL_FILES_MISSING',retryable:false};return;}
 if(child&&child.exitCode===null&&!child.killed)return;
 if(Date.now()-lastLaunch<15000||startupState.retryable===false&&Date.now()-lastLaunch<300000)return;
 lastLaunch=Date.now();
 const trimStartupPages=process.platform==='win32'&&/Qwen3/i.test(config.model)&&Number(config.args.at(-1))>0;
 const executable=trimStartupPages?(process.env.PYTHON_BIN||'python'):config.exe;
 const args=trimStartupPages?[path.join(__dirname,'scripts/run-local-model.py'),config.exe,...config.args]:config.args;
 startupState={reason:'MODEL_STARTING',retryable:true};
 child=require('child_process').spawn(executable,args,{cwd:path.dirname(config.exe),windowsHide:true,stdio:['ignore','ignore','pipe']});
 let startupErrors='';child.stderr.on('data',chunk=>{startupErrors=(startupErrors+chunk.toString()).slice(-12000);});
 const launched=child;
 if(child.pid)fs.writeFileSync(path.join(config.folder,'assistant-runtime.pid'),String(child.pid));
 const clear=()=>{if(child===launched)child=null;};child.once('error',()=>{startupState={reason:'LOCAL_MODEL_START_FAILED',retryable:false};clear();});child.once('exit',()=>{startupState={reason:/out of memory|cudaMalloc failed/i.test(startupErrors)?'GPU_OUT_OF_MEMORY':'LOCAL_MODEL_EXITED',retryable:false};clear();});
}
function ensureLocalAssistant(){if(pending)return pending;pending=launchLocalAssistant().finally(()=>{pending=null;});return pending;}
module.exports={ensureLocalAssistant,launchConfig,bounded,localAddress,startupStatus:()=>({...startupState})};
