'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {TencentReader,startupFailure,launcherFailure}=require('../tencent-reader.cjs');
const {SourceFailure}=require('../source-errors.cjs');const {assertOwnedProfile,removeProfile}=require('../browser-processes.cjs');const {readWithRetries}=require('../publish.cjs');
const source={url:'https://docs.qq.com/sheet/FAKE_DOCUMENT',sheetId:'FAKE_TAB'};
test('startup diagnostics classify known resources and retain fatal operation, OS, exit and signal safely',()=>{
 for(const code of ['EAGAIN','ENOMEM','EMFILE','ENFILE'])assert.equal(startupFailure({code,message:'SECRET'}).retryable,true);
 for(const code of ['EACCES','EPERM','ENOENT','ENOSPC','EIO','SECRET'])assert.equal(startupFailure({code,message:'SECRET'}).retryable,false);
 assert.equal(startupFailure({code:'EBUSY'},'active_port_read').retryable,true);
 assert.equal(startupFailure({code:'EBUSY'},'spawn').retryable,false);
 assert.deepEqual(startupFailure({code:'EACCES'},'spawn').diagnostic,{operation:'spawn',osCode:'EACCES'});
 for(const code of [1,7,21,0xc0000005]){const e=launcherFailure(code,null);assert.equal(e.retryable,false);assert.equal(e.diagnostic.exitCode,code);}
 for(const code of [0xc0000017,0xc000009a])assert.equal(launcherFailure(code,null).retryable,true);
 assert.deepEqual(launcherFailure(null,'SIGTERM').diagnostic,{operation:'launcher_exit',signal:'SIGTERM'});
 const e=new SourceFailure('BROWSER_START_FAILED','browser_start',1,{operation:'SECRET',osCode:'SECRET',signal:'SECRET',exitCode:'SECRET',message:'SECRET'});assert.deepEqual(e.diagnostic,{});
});
test('an exited launcher still captures and terminates profile-owned children before deleting the directory',async()=>{
 const calls=[],root=path.join(os.tmpdir(),'cube-own-test'),profile=path.join(root,'reader-abc123');
 const r=new TencentReader({runtimeRoot:root,processControl:async request=>{calls.push(request.mode);assert.equal(request.profile,profile);if(request.mode==='capture'){assert.equal(request.launcherPid,null);return {proofs:[{pid:42,created:'100'}]};}assert.deepEqual(request.proofs,[{pid:42,created:'100'}]);return {remaining:0,terminated:1};},profileRemoval:async()=>calls.push('remove')});
 r.profile=profile;r.browser={exitCode:0,pid:5};await r.close();assert.deepEqual(calls,['capture','settle','remove']);assert.equal(r.profile,null);
});
test('uncertain or failed termination never removes profile or permits source retry',async()=>{
 for(const captureFailure of [false,true]){
  let removed=0;const root=path.join(os.tmpdir(),'cube-own-test');const r=new TencentReader({runtimeRoot:root,processControl:async req=>{if(req.mode==='capture'){if(captureFailure)throw new SourceFailure('READER_PROCESS_UNCONFIRMED');return {proofs:[]};}return {remaining:1};},profileRemoval:async()=>removed++});r.profile=path.join(root,'reader-abc123');
  await assert.rejects(r.close(),e=>e.code==='READER_PROCESS_UNCONFIRMED'&&!e.retryable);assert.equal(removed,0);assert.ok(r.profile);
 }
});
test('short Windows profile locks recover within six removals; persistent locks and permissions remain fatal',async()=>{
 for(const code of ['EBUSY','EPERM','ENOTEMPTY']){let count=0;const waits=[],events=[];await removeProfile('fixture',{remove:async()=>{if(++count<3)throw Object.assign(Error('SECRET'),{code});},wait:async n=>waits.push(n),onDiagnostic:e=>events.push(e)});assert.equal(count,3);assert.deepEqual(waits,[200,400]);assert.equal(events[0].event,'reader_cleanup_recovered');}
 let count=0;await assert.rejects(removeProfile('fixture',{remove:async()=>{count++;throw Object.assign(Error('SECRET'),{code:'EPERM'});},wait:async()=>{}}),e=>e.code==='READER_PROFILE_BUSY'&&!e.retryable);assert.equal(count,6);
 count=0;await assert.rejects(removeProfile('fixture',{remove:async()=>{count++;throw Object.assign(Error('SECRET'),{code:'EACCES'});}}),e=>e.diagnostic.osCode==='EACCES');assert.equal(count,1);
});
test('profile containment refuses sibling, nested, traversal and non-owned directories',()=>{
 const root=path.join(os.tmpdir(),'cube-own-test');assert.equal(assertOwnedProfile(path.join(root,'reader-abc123'),root),path.join(root,'reader-abc123'));
 for(const p of [root,path.join(root,'other'),path.join(root,'nested','reader-abc'),path.join(root,'..','reader-abc')])assert.throws(()=>assertOwnedProfile(p,root));
});
test('read and cleanup faults are separately retained without raw errors and cleanup prevents a second read',async()=>{
 const logs=[];let creates=0;
 await assert.rejects(readWithRetries(source,{log:s=>logs.push(JSON.parse(s)),readerFactory:()=>{creates++;return {read:async()=>{throw startupFailure({code:'EIO',message:'SECRET'});},close:async()=>{throw new SourceFailure('READER_PROFILE_BUSY','cleanup',0,{operation:'profile_remove',osCode:'EPERM'});}};}}),e=>e.code==='READER_PROFILE_BUSY');
 assert.equal(creates,1);assert.equal(logs[0].event,'read_attempt_failed');assert.equal(logs[0].code,'BROWSER_START_FAILED');assert.equal(logs[0].osCode,'EIO');assert.equal(logs[1].event,'reader_cleanup_failed');assert.equal(logs[1].code,'READER_PROFILE_BUSY');assert.ok(!JSON.stringify(logs).includes('SECRET'));
});
test('allowlisted startup resource faults rebuild and recover; unknown exit never retries',async()=>{
 for(const transient of [true,false]){let creates=0;const logs=[];const operation=readWithRetries(source,{wait:async()=>{},log:s=>logs.push(JSON.parse(s)),readerFactory:()=>{const n=++creates;return {read:async()=>{if(n===1)throw transient?launcherFailure(0xc000009a,null):launcherFailure(1,null);return 'SAFE';},close:async()=>{}};}});
  if(transient){assert.equal(await operation,'SAFE');assert.equal(creates,2);assert.equal(logs.at(-1).event,'read_recovered');}else{await assert.rejects(operation,e=>e.code==='BROWSER_START_FAILED');assert.equal(creates,1);}
 }
});
test('real detached-launcher cleanup terminates only its temporary about:blank Edge',{skip:process.env.CUBE_READER_SMOKE!=='1',timeout:40000},async()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cube-reader-detached-'));const r=new TencentReader({runtimeRoot:root}),other=new TencentReader({runtimeRoot:root});
 try{
  await r.start();await other.start();const socket=r.socket;r.socket=null;r.browser={exitCode:0,pid:null};socket.close();
  await r.close();assert.equal(r.profile,null);
  assert.equal(await other.evaluate('1+1'),2,'a different profile must remain usable');
  await other.close();assert.deepEqual(fs.readdirSync(root),[]);
 }finally{try{await r.close();}finally{await other.close();}assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('cube-reader-detached-'));fs.rmSync(root,{recursive:true,force:true});}
});

