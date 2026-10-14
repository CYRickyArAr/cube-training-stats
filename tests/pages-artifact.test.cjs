'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {ArtifactFailure,classify,waitForArtifact,assertFreshSnapshot,assertArtifactRuntime}=require('../.github/pages-artifact/wait.cjs');
const safe={name:'safe-statistics',id:6,size:100};const pages={name:'github-pages',id:7,size:100};
function sequence(values){let clock=0,index=0;const logs=[];return {logs,get polls(){return index;},options:{expectedId:'7',now:()=>clock,wait:async ms=>clock+=ms,log:v=>logs.push(v),timeoutMs:100,pollMs:10,list:async()=>{const v=values[Math.min(index++,values.length-1)];if(v instanceof Error)throw v;return v;}}};}
test('Pages waits for exact uploaded ID in same runtime service, with two consecutive visible responses',async()=>{
 const h=sequence([[safe],[safe],[safe,pages],[safe,pages]]);await waitForArtifact(h.options);assert.equal(h.polls,4);assert.equal(h.logs.at(-1).event,'pages_artifact_ready');assert.equal(h.logs.at(-1).artifactId,'7');
});
test('visibility regression resets confirmation, and service errors are bounded without deploying',async()=>{
 const h=sequence([[pages],[],new ArtifactFailure('ARTIFACT_SERVICE_TEMPORARY'),[pages],[pages]]);await waitForArtifact(h.options);assert.equal(h.polls,5);
 const missing=sequence([[]]);await assert.rejects(waitForArtifact(missing.options),e=>e.code==='ARTIFACT_VISIBILITY_TIMEOUT');assert.equal(missing.polls,10);assert.ok(!missing.logs.some(l=>l.event==='pages_artifact_ready'));
});
test('permissions, unknown errors, duplicates, wrong IDs and empty artifacts fail immediately',async()=>{
 for(const [v,code] of [[new ArtifactFailure('ARTIFACT_PERMISSION_DENIED'),'ARTIFACT_PERMISSION_DENIED'],[new Error('SECRET'),'ARTIFACT_QUERY_FAILED'],[[pages,pages],'ARTIFACT_DUPLICATE'],[[{...pages,id:8}],'ARTIFACT_ID_MISMATCH'],[[{...pages,size:0}],'ARTIFACT_EMPTY']]){
  const h=sequence([v]);await assert.rejects(waitForArtifact(h.options),e=>e.code===code);assert.equal(h.polls,1);assert.ok(!JSON.stringify(h.logs).includes('SECRET'));
 }
});
test('artifact transport classification retries only recognized temporary failures',()=>{
 for(const status of [401,403])assert.equal(classify({status,message:'SECRET'}),'ARTIFACT_PERMISSION_DENIED');
 for(const status of [408,429,500,502,503,504])assert.equal(classify({status}),'ARTIFACT_SERVICE_TEMPORARY');
 assert.equal(classify({message:'Failed request: (503) SECRET'}),'ARTIFACT_SERVICE_TEMPORARY');
 assert.equal(classify({message:'SECRET',code:'EPERM'}),'ARTIFACT_QUERY_FAILED');
 for(const env of [{},{ACTIONS_RUNTIME_TOKEN:'SECRET'},{ACTIONS_RESULTS_URL:'https://example.invalid'}])assert.throws(()=>assertArtifactRuntime(env),e=>e.code==='ARTIFACT_RUNTIME_UNAVAILABLE'&&!e.message.includes('SECRET'));
 assert.doesNotThrow(()=>assertArtifactRuntime({ACTIONS_RUNTIME_TOKEN:'SECRET',ACTIONS_RESULTS_URL:'https://example.invalid'}));
});
test('freshness guard accepts current snapshots and refuses older or invalid snapshots before deployment',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cube-pages-test-')),file=path.join(dir,'data.json');
 try{fs.writeFileSync(file,JSON.stringify({lastSuccessAt:'2026-10-13T16:00:00Z'}));const logs=[];await assertFreshSnapshot({localFile:file,fetchSnapshot:async()=>({lastSuccessAt:'2026-10-13T15:55:00Z'}),log:v=>logs.push(v)});assert.equal(logs[0].code,'SNAPSHOT_FRESH');
  await assert.rejects(assertFreshSnapshot({localFile:file,fetchSnapshot:async()=>({lastSuccessAt:'2026-10-13T16:05:00Z'})}),e=>e.code==='SNAPSHOT_ROLLBACK_BLOCKED');
  await assert.rejects(assertFreshSnapshot({localFile:file,fetchSnapshot:async()=>({lastSuccessAt:'SECRET'})}),e=>e.code==='SNAPSHOT_TIME_INVALID');
 }finally{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('cube-pages-test-'));fs.rmSync(dir,{recursive:true,force:true});}
});
test('workflow gates one deployment after exact ID visibility, preserving concurrency and permissions',()=>{
 const y=fs.readFileSync(path.join(__dirname,'../.github/workflows/pages.yml'),'utf8');
 const gate=y.indexOf('uses: ./.github/pages-artifact');
 assert.equal((y.match(/uses: actions\/deploy-pages@v5/g)||[]).length,1);assert.ok(gate>=0&&gate<y.indexOf('uses: actions/deploy-pages@v5'));
 assert.ok(!y.includes('run: node .github/pages-artifact/wait.cjs'));
 const action=fs.readFileSync(path.join(__dirname,'../.github/pages-artifact/action.yml'),'utf8');
 assert.match(action,/using: node24/);assert.match(action,/main: wait\.cjs/);
 assert.ok(y.includes('steps.pages_artifact.outputs.artifact_id'));assert.ok(y.includes('cancel-in-progress: false'));assert.ok(!y.includes('actions: write'));
});

