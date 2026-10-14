'use strict';
const fs=require('node:fs');const path=require('node:path');const {fork}=require('node:child_process');
class ArtifactFailure extends Error{constructor(code){super(code);this.code=code;}}
function classify(error){
 const status=Number(error?.status)||Number(/Failed request: \((\d{3})\)/.exec(String(error?.message))?.[1]);
 if([401,403].includes(status))return 'ARTIFACT_PERMISSION_DENIED';
 if([408,429,500,502,503,504].includes(status))return 'ARTIFACT_SERVICE_TEMPORARY';
 if(['ECONNRESET','ECONNREFUSED','ETIMEDOUT','EAI_AGAIN'].includes(error?.code))return 'ARTIFACT_SERVICE_TEMPORARY';
 return 'ARTIFACT_QUERY_FAILED';
}
function assertArtifactRuntime(env=process.env){
 // These are injected into JavaScript actions, not ordinary `run` steps.
 // Report presence only; never log, export or persist their values.
 if(!env.ACTIONS_RUNTIME_TOKEN||!env.ACTIONS_RESULTS_URL)throw new ArtifactFailure('ARTIFACT_RUNTIME_UNAVAILABLE');
}
function listFromSameService({timeoutMs=10000}={}){
 assertArtifactRuntime();
 return new Promise((resolve,reject)=>{
  const child=fork(__filename,['--list'],{stdio:['ignore','ignore','ignore','ipc']});let done=false;
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);child.kill();error?reject(error):resolve(value);};
  const timer=setTimeout(()=>finish(new ArtifactFailure('ARTIFACT_SERVICE_TEMPORARY')),timeoutMs);
  child.once('message',value=>value?.ok?finish(null,value.artifacts):finish(new ArtifactFailure(['ARTIFACT_PERMISSION_DENIED','ARTIFACT_SERVICE_TEMPORARY'].includes(value?.code)?value.code:'ARTIFACT_QUERY_FAILED')));
  child.once('error',()=>finish(new ArtifactFailure('ARTIFACT_QUERY_FAILED')));
  child.once('exit',()=>finish(new ArtifactFailure('ARTIFACT_QUERY_FAILED')));
 });
}
async function waitForArtifact({expectedId,list=listFromSameService,now=Date.now,wait=ms=>new Promise(r=>setTimeout(r,ms)),log=v=>console.log(JSON.stringify(v)),timeoutMs=60000,pollMs=2000}){
 if(!/^\d+$/.test(String(expectedId))||!Number.isSafeInteger(Number(expectedId))||Number(expectedId)<=0)throw new ArtifactFailure('ARTIFACT_ID_INVALID');
 const started=now(),deadline=started+timeoutMs;let stable=0,polls=0;
 while(now()<deadline){
  polls++;let artifacts;
  try{artifacts=await list({timeoutMs:Math.min(10000,Math.max(1,deadline-now()))});}catch(error){
   const code=error instanceof ArtifactFailure?error.code:'ARTIFACT_QUERY_FAILED';
   if(code!=='ARTIFACT_SERVICE_TEMPORARY')throw new ArtifactFailure(code);
   stable=0;log({event:'pages_artifact_wait',code,polls});await wait(Math.min(pollMs,Math.max(0,deadline-now())));continue;
  }
  if(now()>=deadline)break;
  if(!Array.isArray(artifacts))throw new ArtifactFailure('ARTIFACT_RESPONSE_INVALID');
  const matches=artifacts.filter(a=>a.name==='github-pages');
  if(matches.length>1)throw new ArtifactFailure('ARTIFACT_DUPLICATE');
  if(matches.length===1){
   if(String(matches[0].id)!==String(expectedId))throw new ArtifactFailure('ARTIFACT_ID_MISMATCH');
   if(!(Number(matches[0].size)>0))throw new ArtifactFailure('ARTIFACT_EMPTY');
   if(++stable>=2){log({event:'pages_artifact_ready',code:'ARTIFACT_READY',polls,elapsedMs:now()-started,artifactId:String(expectedId)});return;}
  }else stable=0;
  log({event:'pages_artifact_wait',code:matches.length?'ARTIFACT_CONFIRMING':'ARTIFACT_NOT_VISIBLE',polls});
  await wait(Math.min(pollMs,Math.max(0,deadline-now())));
 }
 throw new ArtifactFailure('ARTIFACT_VISIBILITY_TIMEOUT');
}
async function assertFreshSnapshot({localFile=path.resolve('public/data.json'),fetchSnapshot=async()=>{
 const r=await fetch('https://cyrickyarar.github.io/cube-training-stats/data.json?publication='+Date.now(),{cache:'no-store',signal:AbortSignal.timeout(5000)});
 if(!r.ok)throw new ArtifactFailure('PUBLIC_SNAPSHOT_UNAVAILABLE');return r.json();
},log=v=>console.log(JSON.stringify(v))}={}){
 const current=JSON.parse(fs.readFileSync(localFile,'utf8'));
 const incoming=Date.parse(current.lastSuccessAt);if(!Number.isFinite(incoming))throw new ArtifactFailure('SNAPSHOT_TIME_INVALID');
 let deployed;
 for(let n=0;n<3;n++){try{deployed=await fetchSnapshot();break;}catch{if(n===2)throw new ArtifactFailure('PUBLIC_SNAPSHOT_UNAVAILABLE');await new Promise(r=>setTimeout(r,1000));}}
 const previous=Date.parse(deployed?.lastSuccessAt);if(!Number.isFinite(previous))throw new ArtifactFailure('SNAPSHOT_TIME_INVALID');
 if(incoming<previous)throw new ArtifactFailure('SNAPSHOT_ROLLBACK_BLOCKED');
 log({event:'pages_snapshot_verified',code:'SNAPSHOT_FRESH',lastSuccessAt:current.lastSuccessAt});
}
module.exports={ArtifactFailure,classify,waitForArtifact,assertFreshSnapshot,assertArtifactRuntime};
if(require.main===module){
 if(process.argv[2]==='--list'){
  const {DefaultArtifactClient}=require('@actions/artifact');
  new DefaultArtifactClient().listArtifacts().then(result=>process.send({ok:true,artifacts:result.artifacts.map(a=>({id:a.id,name:a.name,size:a.size}))}),error=>process.send({ok:false,code:classify(error)}));
 }else waitForArtifact({expectedId:process.env.PAGES_ARTIFACT_ID}).then(()=>assertFreshSnapshot()).catch(error=>{
  const code=error instanceof ArtifactFailure?error.code:'PAGES_PREFLIGHT_FAILED';console.error(JSON.stringify({event:'pages_preflight_failed',code}));process.exitCode=1;
 });
}

