'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {SourceFailure}=require('../source-errors.cjs');const {TencentReader,parseDevToolsActivePort}=require('../tencent-reader.cjs');const {readWithRetries,runPublication}=require('../publish.cjs');
const source={url:'https://docs.qq.com/sheet/PRIVATE_DOCUMENT_456?tab=PRIVATE_TAB_SAFE&rtkey=PRIVATE_KEY_DONT_LOG',sheetId:'PRIVATE_TAB_SAFE'};
const raw={allLoaded:true,sheetId:source.sheetId,title:'Synthetic',sheetName:'Synthetic',cells:[{row:1,col:2,value:'Test'},{row:2,col:1,value:'2026-10-13'},{row:2,col:2,value:6.5}]};
function harness(actions){const calls=[],logs=[],delays=[];let next=0;return {calls,logs,delays,options:{log:text=>logs.push(JSON.parse(text)),wait:async ms=>delays.push(ms),readerFactory:({signal})=>{const n=++next;calls.push('create'+n);return {phase:'source_read',async read(){calls.push('read'+n);const action=actions[n-1]??actions.at(-1);return typeof action==='function'?action(signal):action;},async close(){calls.push('close'+n);}};}}};}
const temporary=()=>fs.mkdtempSync(path.join(os.tmpdir(),'cube-publication-test-'));
function removeTemporary(dir){const target=path.resolve(dir),root=path.resolve(os.tmpdir());assert.equal(path.dirname(target),root);assert.ok(path.basename(target).startsWith('cube-publication-test-'));fs.rmSync(target,{recursive:true,force:true});}
function assertSanitized(logs){const text=JSON.stringify(logs);for(const secret of [source.url,source.sheetId,'PRIVATE_DOCUMENT_456','PRIVATE_KEY_DONT_LOG','RAW_SECRET','https://private.example'])assert.ok(!text.includes(secret));for(const entry of logs)assert.ok(Object.keys(entry).every(k=>['event','stage','code','attempt','maxAttempts','elapsedMs','willRetry','people','records','lastSuccessAt','operation','osCode','exitCode','signal','cleanupAttempt','terminated'].includes(k)));}

test('known transient failure closes and rebuilds the reader before a successful retry',async()=>{
 const h=harness([()=>{throw new SourceFailure('CDP_TIMEOUT');},raw]);assert.deepEqual(await readWithRetries(source,h.options),raw);
 assert.deepEqual(h.calls,['create1','read1','close1','create2','read2','close2']);assert.deepEqual(h.delays,[1000]);assert.equal(h.logs[0].code,'CDP_TIMEOUT');assert.equal(h.logs[0].willRetry,true);assert.equal(h.logs.at(-1).event,'read_recovered');assertSanitized(h.logs);
});
test('repeated transient faults stop after exactly three attempts',async()=>{
 const h=harness([()=>{throw new SourceFailure('DEBUG_SOCKET_DISCONNECTED');}]);await assert.rejects(readWithRetries(source,h.options),e=>e.code==='DEBUG_SOCKET_DISCONNECTED'&&e.attempt===3);
 assert.equal(h.calls.filter(x=>x.startsWith('create')).length,3);assert.equal(h.calls.filter(x=>x.startsWith('close')).length,3);assert.deepEqual(h.delays,[1000,3000]);assert.equal(h.logs.at(-1).willRetry,false);assertSanitized(h.logs);
});
test('permission, configuration, script, browser and validation failures never retry',async()=>{
 for(const code of ['SOURCE_PERMISSION_DENIED','CONFIG_INVALID','BROWSER_PERMISSION_DENIED','BROWSER_MISSING','BROWSER_START_FAILED','SOURCE_NAVIGATION_DENIED','SOURCE_SCRIPT_ERROR','SOURCE_LIMIT_EXCEEDED','DATA_INVALID','PRIVACY_BLOCKED']){
  const h=harness([()=>{throw new SourceFailure(code);}]);await assert.rejects(readWithRetries(source,h.options),e=>e.code===code);assert.deepEqual(h.calls,['create1','read1','close1']);assert.deepEqual(h.delays,[]);assertSanitized(h.logs);
 }
});
test('unclassified exceptions and forged retry fields remain fatal without leaking raw messages',async()=>{
 const error=Object.assign(new Error('RAW_SECRET '+source.url+' https://private.example'),{code:'CDP_TIMEOUT',stage:'RAW_SECRET',retryable:true});const h=harness([()=>{throw error;}]);await assert.rejects(readWithRetries(source,h.options),e=>e.code==='UNCLASSIFIED_READ_ERROR');assert.equal(h.calls.length,3);assertSanitized(h.logs);
});
test('attempt timeout aborts the operation and closes the timed-out reader',async()=>{
 const h=harness([signal=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}))]);
 await assert.rejects(readWithRetries(source,{...h.options,policy:{maxAttempts:1,attemptTimeoutMs:10,totalTimeoutMs:100,cleanupTimeoutMs:20,retryDelaysMs:[]}}),e=>e.code==='READ_ATTEMPT_TIMEOUT');assert.deepEqual(h.calls,['create1','read1','close1']);assertSanitized(h.logs);
});
test('total budget includes failures and backoff and prevents a third attempt',async()=>{
 let clock=0;const h=harness([()=>{clock+=60;throw new SourceFailure('CDP_TIMEOUT');}]);
 await assert.rejects(readWithRetries(source,{...h.options,now:()=>clock,wait:async ms=>{clock+=ms;h.delays.push(ms);},policy:{attemptTimeoutMs:80,totalTimeoutMs:100,cleanupTimeoutMs:20,retryDelaysMs:[5,5]}}),e=>e.code==='READ_TOTAL_TIMEOUT');assert.equal(h.calls.filter(x=>x.startsWith('create')).length,2);assert.equal(h.calls.filter(x=>x.startsWith('close')).length,2);assert.deepEqual(h.delays,[5]);
});
test('cleanup failure or timeout prevents retry and never produces a successful result',async()=>{
 for(const hang of [false,true]){let creates=0;const logs=[];
  await assert.rejects(readWithRetries(source,{log:text=>logs.push(JSON.parse(text)),wait:async()=>{},policy:{cleanupTimeoutMs:10},readerFactory:()=>{creates++;return {read:async()=>{throw new SourceFailure('CDP_TIMEOUT');},close:async()=>{if(hang)return new Promise(()=>{});throw Error('RAW_SECRET');}};}}),e=>e.code==='READER_CLEANUP_FAILED');assert.equal(creates,1);assertSanitized(logs);
 }
});
test('aborted reader operations and connecting sockets clean up without a browser or source request',async()=>{
 const controller=new AbortController();controller.abort();const reader=new TencentReader({signal:controller.signal});await assert.rejects(reader.read(source),e=>e.code==='READ_ATTEMPT_TIMEOUT');let closed=0;reader.socket={readyState:0,close(){closed++;}};await reader.close();assert.equal(closed,1);assert.equal(reader.socket,null);
});
test('explicit source access-denial page fails immediately instead of being retried as a readiness timeout',async()=>{const reader=new TencentReader();reader.start=async()=>{};reader.cdp=async()=>({});reader.evaluate=async expression=>expression.includes('SpreadsheetApp')?JSON.stringify({ready:false}):'没有权限 RAW_SECRET';await assert.rejects(reader.read(source),error=>error.code==='SOURCE_PERMISSION_DENIED'&&!error.retryable);});
test('DevTools readiness rejects partial port files and requires a complete browser endpoint',()=>{
 for(const text of ['','12345','12345\n','12345\n/devtools/browser/partial','0\n/devtools/browser/9308a6f4-a1e2-4423-b31d-d7accc7e55f8','65536\n/devtools/browser/9308a6f4-a1e2-4423-b31d-d7accc7e55f8'])assert.equal(parseDevToolsActivePort(text),null);
 assert.equal(parseDevToolsActivePort('12345\n/devtools/browser/9308a6f4-a1e2-4423-b31d-d7accc7e55f8'),'12345');
});
test('publication logs safe configuration failure before constructing a reader',async()=>{
 let creates=0;const logs=[];await assert.rejects(runPublication({sourceConfig:'{"RAW_SECRET":',readerFactory:()=>{creates++;},log:text=>logs.push(JSON.parse(text))}),e=>e.code==='CONFIG_INVALID');assert.equal(creates,0);assert.equal(logs.at(-1).stage,'configuration');assertSanitized(logs);
});
test('real publication succeeds only after a recovered read and keeps private values out of JSON and logs',async()=>{
 const dir=temporary(),out=path.join(dir,'out');const h=harness([()=>{throw new SourceFailure('CDP_CONTEXT_LOST');},structuredClone(raw)]);
 try{const payload=await runPublication({sourceConfig:JSON.stringify(source),outputDir:out,readerFactory:h.options.readerFactory,log:h.options.log,readOptions:{wait:h.options.wait}});assert.equal(payload.data.records.length,1);assert.equal(h.logs.some(l=>l.event==='read_recovered'),true);assert.equal(h.logs.at(-1).event,'published');assert.equal(JSON.parse(fs.readFileSync(path.join(out,'data.json'),'utf8')).data.records[0].score,650);assertSanitized(h.logs);const json=fs.readFileSync(path.join(out,'data.json'),'utf8');assert.ok(!json.includes(source.sheetId)&&!json.includes('PRIVATE_KEY_DONT_LOG'));}finally{removeTemporary(dir);}
});
test('conversion and privacy failures never reread or overwrite the last successful snapshot',async()=>{
 for(const privacy of [false,true]){const dir=temporary(),out=path.join(dir,'out');fs.mkdirSync(out);fs.writeFileSync(path.join(out,'data.json'),'LAST_SUCCESS');const bad=structuredClone(raw);if(privacy)bad.cells[0].value=source.sheetId;else bad.allLoaded=false;const h=harness([bad]);
  try{await assert.rejects(runPublication({sourceConfig:JSON.stringify(source),outputDir:out,readerFactory:h.options.readerFactory,log:h.options.log,readOptions:{wait:h.options.wait}}),e=>e.code===(privacy?'PRIVACY_BLOCKED':'DATA_INVALID'));assert.deepEqual(h.calls,['create1','read1','close1']);assert.equal(fs.readFileSync(path.join(out,'data.json'),'utf8'),'LAST_SUCCESS');assertSanitized(h.logs);}finally{removeTemporary(dir);}
 }
});
test('output and asset failures remain fatal with a single read and controlled diagnostics',async()=>{
 for(const missingAssets of [false,true]){const dir=temporary();fs.writeFileSync(path.join(dir,'blocked'),'file');const h=harness([structuredClone(raw)]);
  try{await assert.rejects(runPublication({sourceConfig:JSON.stringify(source),outputDir:path.join(dir,'blocked','out'),rootDir:missingAssets?path.join(dir,'missing'):path.join(__dirname,'..'),readerFactory:h.options.readerFactory,log:h.options.log}),e=>e.code===(missingAssets?'ASSET_INVALID':'OUTPUT_FAILED'));assert.deepEqual(h.calls,['create1','read1','close1']);assertSanitized(h.logs);}finally{removeTemporary(dir);}
 }
});
test('startup smoke uses only about:blank and cleans its own temporary browser',{skip:process.env.CUBE_READER_SMOKE!=='1',timeout:20000},async()=>{
 const dir=temporary();const reader=new TencentReader({runtimeRoot:dir,signal:AbortSignal.timeout(10000)});try{await reader.start();assert.equal(reader.socket.readyState,1);}finally{await reader.close();assert.equal(reader.browser,null);assert.equal(reader.profile,null);removeTemporary(dir);}
});
