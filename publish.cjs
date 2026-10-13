'use strict';
const fs=require('node:fs');const path=require('node:path');const {createHash}=require('node:crypto');
const {TencentReader,assertSource}=require('./tencent-reader.cjs');const {SourceFailure,failureFrom}=require('./source-errors.cjs');const {convertSnapshot}=require('./tencent-sheet.cjs');
function assertSafe(text,source){
  const url=new URL(source.url);const forbidden=[source.url,source.sheetId,url.pathname.split('/').pop(),...Array.from(url.searchParams.values()).filter(value=>value.length>=8)].filter(Boolean);
  if(/docs\.qq\.com|rtkey\s*[=:]/i.test(text)||forbidden.some(value=>text.includes(value)))throw new SourceFailure('PRIVACY_BLOCKED');
}
const SOURCE_BUTTON='<a id="source-link" class="button-link" target="_blank" rel="noopener noreferrer" aria-disabled="true">打开腾讯文档</a>';
function documentUrl(source){
  assertSource(source);
  const url=new URL(source.url);
  if(url.origin!=='https://docs.qq.com')throw new SourceFailure('CONFIG_INVALID');
  // The owner permits publishing the document address, not access credentials,
  // worksheet identifiers, tracking parameters, or the private reader config.
  return url.origin+url.pathname;
}
function publishedSourceButton(source){
  return SOURCE_BUTTON.replace('aria-disabled="true"',`href="${documentUrl(source)}"`);
}
function assertPublicPage(text,source){
  const button=publishedSourceButton(source);
  if(text.split(button).length!==2||text.split('id="source-link"').length!==2)throw new SourceFailure('ASSET_INVALID');
  // Exempt exactly the approved href, never arbitrary document IDs or URLs.
  assertSafe(text.replace(button,SOURCE_BUTTON),source);
}
function publicPage(text,source){
  assertSafe(text,source);
  if(text.split(SOURCE_BUTTON).length!==2)throw new SourceFailure('ASSET_INVALID');
  const html=text.replace(SOURCE_BUTTON,publishedSourceButton(source));
  assertPublicPage(html,source);
  return html;
}
function versionAssets(html,assets){
  for(const [name,attribute] of [['styles.css','href'],['core.js','src'],['app.js','src']]){
    if(typeof assets[name]!=='string')throw new SourceFailure('ASSET_INVALID');
    const reference=`${attribute}="${name}"`;
    if(html.split(reference).length!==2)throw new SourceFailure('ASSET_INVALID');
    const version=createHash('sha256').update(assets[name]).digest('hex').slice(0,12);
    html=html.replace(reference,`${attribute}="${name}?v=${version}"`);
  }
  return html;
}
function publicPayload(data,source,at=new Date().toISOString()){
  if(!data?.people?.length||!data?.records?.length)throw new SourceFailure('DATA_INVALID');
  const ids=new Map(data.people.map((p,i)=>[p.id,'p'+(i+1)]));
  const people=data.people.map(p=>({id:ids.get(p.id),name:p.name,target:null}));
  const records=data.records.map((r,i)=>{
    if(!ids.has(r.personId))throw new SourceFailure('DATA_INVALID');
    return {id:'r'+(i+1),personId:ids.get(r.personId),score:r.score,at:r.at??null,date:r.date??null,note:'',sourceRow:r.sourceRow,sourceColumn:r.sourceColumn,sourceCell:r.sourceCell,sourceValue:r.score===null?'DNF':r.score/100,sourceText:r.sourceText};
  });
  const safeSource={title:'训练成绩',sheetName:'公开统计快照'};
  const warnings=(data.warnings||[]).map(w=>({cell:w.cell,message:w.message}));
  const payload={data:{version:1,people,records,warnings,source:safeSource},source:safeSource,lastSuccessAt:at,attemptedAt:at,refreshing:false,stale:false,error:null,syncIntervalMs:60000};
  assertSafe(JSON.stringify(payload),source);return payload;
}
const READ_POLICY=Object.freeze({maxAttempts:3,attemptTimeoutMs:90000,totalTimeoutMs:180000,cleanupTimeoutMs:10000,retryDelaysMs:[1000,3000]});
function emit(log,event,failure,attempt,elapsedMs,willRetry=false){
 const safe=failureFrom(failure);log(JSON.stringify({event,stage:safe.stage,code:safe.code,attempt,maxAttempts:READ_POLICY.maxAttempts,elapsedMs:Math.max(0,Math.round(elapsedMs)),willRetry}));
}
function bounded(promise,ms,failure,onTimeout){
 let timer;const limit=new Promise((resolve,reject)=>{timer=setTimeout(()=>{reject(failure);onTimeout?.(failure);},Math.max(1,ms));});
 return Promise.race([promise,limit]).finally(()=>clearTimeout(timer));
}
async function readWithRetries(source,{readerFactory=options=>new TencentReader(options),log=text=>console.log(text),now=Date.now,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),policy=READ_POLICY}={}){
 const p={...READ_POLICY,...policy};if(!Number.isInteger(p.maxAttempts)||p.maxAttempts<1||p.maxAttempts>3||![p.attemptTimeoutMs,p.totalTimeoutMs,p.cleanupTimeoutMs].every(n=>Number.isFinite(n)&&n>0)||p.attemptTimeoutMs>READ_POLICY.attemptTimeoutMs||p.totalTimeoutMs>READ_POLICY.totalTimeoutMs||p.cleanupTimeoutMs>READ_POLICY.cleanupTimeoutMs||!Array.isArray(p.retryDelaysMs)||p.retryDelaysMs.some(n=>!Number.isFinite(n)||n<0||n>3000))throw new SourceFailure('CONFIG_INVALID');
 const started=now(),deadline=started+p.totalTimeoutMs;
 for(let attempt=1;attempt<=p.maxAttempts;attempt++){
  const remaining=deadline-now();if(remaining<=0)throw new SourceFailure('READ_TOTAL_TIMEOUT','source_read',attempt-1);
  const controller=new AbortController();let reader,raw,failure;
  try{
   reader=readerFactory({signal:controller.signal});
   raw=await bounded(Promise.resolve().then(()=>reader.read(source)),Math.min(p.attemptTimeoutMs,remaining),new SourceFailure('READ_ATTEMPT_TIMEOUT','source_read',attempt),error=>controller.abort(error));
  }catch(error){failure=failureFrom(error,'UNCLASSIFIED_READ_ERROR',reader?.phase||'source_read',attempt);}
  finally{
   if(reader){try{await bounded(Promise.resolve().then(()=>reader.close()),p.cleanupTimeoutMs,new SourceFailure('READER_CLEANUP_FAILED','cleanup',attempt));}catch{failure=new SourceFailure('READER_CLEANUP_FAILED','cleanup',attempt);}}
  }
  if(!failure){if(now()>deadline)throw new SourceFailure('READ_TOTAL_TIMEOUT','source_read',attempt);log(JSON.stringify({event:attempt>1?'read_recovered':'read_succeeded',stage:'source_read',code:'READ_OK',attempt,maxAttempts:p.maxAttempts,elapsedMs:Math.max(0,Math.round(now()-started))}));return raw;}
  const delay=p.retryDelaysMs[attempt-1]??0;
  const willRetry=failure.retryable&&attempt<p.maxAttempts&&now()+delay<deadline;
  emit(log,'read_attempt_failed',failure,attempt,now()-started,willRetry);
  if(!willRetry){if(failure.retryable&&now()+delay>=deadline)throw new SourceFailure('READ_TOTAL_TIMEOUT','source_read',attempt);throw failure;}
  await wait(delay);
 }
}
async function runPublication({sourceConfig=process.env.SOURCE_CONFIG,outputDir=process.env.PUBLIC_OUTPUT||path.join(__dirname,'dist'),rootDir=__dirname,readerFactory,log=text=>console.log(text),readOptions={}}={}){
 let stage='configuration';
 try{
  let source;try{source=JSON.parse(sourceConfig||'null');assertSource(source);}catch{throw new SourceFailure('CONFIG_INVALID');}
  stage='source_read';const raw=await readWithRetries(source,{...readOptions,readerFactory,log});
  stage='conversion';let data;try{data=convertSnapshot(raw,source);}catch{throw new SourceFailure('DATA_INVALID');}
  stage='privacy';const payload=publicPayload(data,source);
  stage='assets';const assets=Object.fromEntries(['styles.css','core.js','app.js'].map(name=>[name,fs.readFileSync(path.join(rootDir,name),'utf8')]));
  const html=versionAssets(publicPage(fs.readFileSync(path.join(rootDir,'index.html'),'utf8'),source),assets);assertPublicPage(html,source);
  for(const text of Object.values(assets))assertSafe(text,source);
  stage='output';const out=path.resolve(outputDir);fs.mkdirSync(out,{recursive:true});
  for(const [name,text]of Object.entries(assets))fs.writeFileSync(path.join(out,name),text);
  fs.writeFileSync(path.join(out,'index.html'),html);fs.writeFileSync(path.join(out,'data.json'),JSON.stringify(payload));fs.writeFileSync(path.join(out,'.nojekyll'),'');
  log(JSON.stringify({event:'published',stage:'output',code:'PUBLICATION_OK',people:payload.data.people.length,records:payload.data.records.length,lastSuccessAt:payload.lastSuccessAt}));return payload;
 }catch(error){const fallback={configuration:'CONFIG_INVALID',source_read:'UNCLASSIFIED_READ_ERROR',conversion:'DATA_INVALID',privacy:'PRIVACY_BLOCKED',assets:'ASSET_INVALID',output:'OUTPUT_FAILED'}[stage];const failure=failureFrom(error,fallback,stage);emit(log,'publication_failed',failure,failure.attempt,0);throw failure;}
}
module.exports={publicPayload,assertSafe,documentUrl,publicPage,assertPublicPage,versionAssets,readWithRetries,runPublication,READ_POLICY};
if(require.main===module)runPublication().catch(()=>{process.exitCode=1;});
