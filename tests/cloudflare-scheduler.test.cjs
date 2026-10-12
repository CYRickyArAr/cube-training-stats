const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const worker=()=>import('../automation/cloudflare/worker.mjs');
const env={GITHUB_TOKEN:'test-only-token'};
const fixedNow=Date.parse('2026-10-12T03:00:00Z');
const options={now:()=>fixedNow,wait:async()=>{}};
const queued=(overrides={})=>({id:37448000000,run_number:1424,status:'queued',head_branch:'main',created_at:'2026-10-07T16:54:00Z',updated_at:'2026-10-07T16:54:00Z',...overrides});
function mock({run=null,jobs={total_count:0,jobs:[]},status='queued'}={}) {
  const requests=[];
  return {requests,request:async(url,requestOptions)=>{
    requests.push({url,options:requestOptions});
    if (requestOptions.method==='POST') return new Response(null,{status:204});
    if (url.includes('/jobs?')) return Response.json(jobs);
    return Response.json({workflow_runs:new URL(url).searchParams.get('status')===status&&run?[run]:[]});
  }};
}

test('Cloudflare scheduler only dispatches the fixed workflow after checking active runs',async()=>{
  const {triggerUpdate}=await worker();const requests=[];
  assert.equal(await triggerUpdate(env,async(url,requestOptions)=>{
    requests.push({url,options:requestOptions});
    assert.equal(requestOptions.headers.Authorization,'Bearer test-only-token');
    assert.ok(url.startsWith('https://api.github.com/repos/CYRickyArAr/cube-training-stats/actions/workflows/pages.yml/'));
    return requestOptions.method==='POST'?new Response(null,{status:204}):Response.json({workflow_runs:[]});
  },options),'dispatched');
  assert.equal(requests.length,6);assert.equal(requests.at(-1).options.body,JSON.stringify({ref:'main'}));
});

test('active run skips dispatch; missing secret and API errors fail closed without leaking tokens',async()=>{
  const {triggerUpdate}=await worker();let calls=0;
  assert.match(await triggerUpdate(env,async()=>{calls++;return Response.json({workflow_runs:[{id:1}]});},options),/^skipped/);
  assert.equal(calls,1);
  await assert.rejects(triggerUpdate({},()=>{throw Error('must not call');},options),/Missing GITHUB_TOKEN/);
  await assert.rejects(triggerUpdate(env,async()=>new Response('test-only-token',{status:401}),options),error=>error.message==='GitHub API HTTP 401 (queued runs, attempt 1/3)');
  await assert.rejects(triggerUpdate(env,async()=>Response.json({}),options),/Invalid GitHub run list/);
});

test('stale main queued run with no jobs in any attempt no longer blocks dispatch or gets cancelled',async()=>{
  const {triggerUpdate}=await worker();const api=mock({run:queued()});
  assert.match(await triggerUpdate(env,api.request,options),/^dispatched; ignored stale queued #1424, age=\d+m, jobs=0$/);
  assert.equal(api.requests.length,7);assert.ok(api.requests[1].url.includes('/runs/37448000000/jobs?filter=all&per_page=1'));
  assert.equal(api.requests.filter(r=>r.options.method==='POST').length,1);
  assert.ok(api.requests.every(r=>!r.url.includes('/cancel')));
});

test('fresh or recently requeued work stays protected even when the original run is old',async()=>{
  const {triggerUpdate}=await worker();const recent=new Date(fixedNow-29*60000).toISOString();
  for(const run of [queued({created_at:recent,updated_at:recent}),queued({updated_at:recent})]){
    const api=mock({run});assert.match(await triggerUpdate(env,api.request,options),/^skipped/);assert.equal(api.requests.length,1);
  }
  const threshold=mock({run:queued({created_at:new Date(fixedNow-30*60000).toISOString(),updated_at:new Date(fixedNow-30*60000).toISOString()})});
  assert.match(await triggerUpdate(env,threshold.request,options),/^dispatched/);
});

test('old queued runs with jobs, unknown timestamps, future timestamps or incomplete identity stay protected',async()=>{
  const {triggerUpdate}=await worker();
  const withJobs=mock({run:queued(),jobs:{total_count:1,jobs:[{status:'queued'}]}});
  assert.match(await triggerUpdate(env,withJobs.request,options),/^skipped/);assert.equal(withJobs.requests.length,2);
  for(const run of [queued({created_at:'bad',updated_at:null}),queued({updated_at:new Date(fixedNow+60000).toISOString()}),queued({id:undefined}),queued({head_branch:'other'}),queued({status:'waiting'})]){
    const api=mock({run});assert.match(await triggerUpdate(env,api.request,options),/^skipped/);assert.equal(api.requests.length,1);
  }
});

test('running jobs, manual approval waits, pending and requested states block regardless of age',async()=>{
  const {triggerUpdate}=await worker();
  for(const status of ['in_progress','waiting','pending','requested']){
    const api=mock({status,run:queued({status})});assert.match(await triggerUpdate(env,api.request,options),new RegExp('^skipped:.*'+status));
    assert.ok(api.requests.every(r=>!r.options.method&&!r.url.includes('/jobs?')));
  }
});

test('missing job evidence or malformed JSON cannot cause a dispatch',async()=>{
  const {triggerUpdate}=await worker();const api=mock({run:queued(),jobs:{jobs:[]}});
  await assert.rejects(triggerUpdate(env,api.request,options),/Invalid GitHub job list/);
  assert.ok(api.requests.every(r=>!r.options.method));
  await assert.rejects(triggerUpdate(env,async()=>new Response('not-json'),options),/Invalid GitHub JSON \(queued runs\)/);
});

test('transient GET failures retry twice with bounded backoff and retain diagnostic counts',async()=>{
  const {triggerUpdate}=await worker();let calls=0;const waits=[];
  const result=await triggerUpdate(env,async(url,requestOptions)=>{
    calls++;if(calls<=2)return new Response('test-only-token',{status:503});
    return requestOptions.method==='POST'?new Response(null,{status:204}):Response.json({workflow_runs:[]});
  },{...options,wait:async ms=>waits.push(ms)});
  assert.equal(result,'dispatched; GET retries=2');assert.equal(calls,8);assert.deepEqual(waits,[250,1000]);
});

test('network read failures have a finite retry limit and sanitized errors',async()=>{
  const {triggerUpdate}=await worker();let calls=0;
  await assert.rejects(triggerUpdate(env,async()=>{calls++;throw Error('test-only-token PRIVATE-SOURCE');},options),error=>error.message==='GitHub API network failure (queued runs, attempt 3/3)');
  assert.equal(calls,3);
  calls=0;await assert.rejects(triggerUpdate(env,async()=>{calls++;return new Response('private',{status:503});},options),/HTTP 503.*attempt 3\/3/);assert.equal(calls,3);
});

test('authentication and rate-limit failures wait for the next Cron rather than hammering the API',async()=>{
  const {triggerUpdate}=await worker();
  for(const status of [401,403,429]){
    let calls=0;await assert.rejects(triggerUpdate(env,async()=>{calls++;return new Response('test-only-token',{status});},options),new RegExp('HTTP '+status));assert.equal(calls,1);
  }
});

test('dispatch errors are never retried because the POST might already have been accepted',async()=>{
  const {triggerUpdate}=await worker();
  for(const networkFailure of [false,true]){
    let posts=0;
    await assert.rejects(triggerUpdate(env,async(url,requestOptions)=>{
      if(requestOptions.method==='POST'){posts++;if(networkFailure)throw Error('test-only-token');return new Response('test-only-token',{status:503});}
      return Response.json({workflow_runs:[]});
    },options),error=>/dispatch outcome unknown, not retried/.test(error.message)&&!error.message.includes('test-only-token'));
    assert.equal(posts,1);
  }
});

test('Cron failures are logged safely and remain failed',async()=>{
  const module=await worker();const originalFetch=global.fetch,originalError=console.error;const lines=[];
  try{
    global.fetch=async()=>new Response('test-only-token',{status:401});console.error=message=>lines.push(message);
    await assert.rejects(module.default.scheduled({},env),/HTTP 401/);
    assert.match(lines[0],/^scheduler failed: GitHub API HTTP 401/);assert.ok(!lines.join('\n').includes('test-only-token'));
  }finally{global.fetch=originalFetch;console.error=originalError;}
});

test('scheduler retains five-minute Cron, no public endpoint and workflow concurrency with privacy gating',async()=>{
  const config=JSON.parse(fs.readFileSync(path.join(__dirname,'../automation/cloudflare/wrangler.jsonc'),'utf8'));
  assert.deepEqual(config.triggers.crons,['*/5 * * * *']);assert.equal(config.workers_dev,false);assert.equal(config.preview_urls,false);
  assert.equal((await worker()).default.fetch,undefined);
  const workflow=fs.readFileSync(path.join(__dirname,'../.github/workflows/pages.yml'),'utf8');
  assert.match(workflow,/group: statistics-pages\s+cancel-in-progress: false/);assert.match(workflow,/needs: read/);assert.match(workflow,/Test publication privacy rules/);
});
