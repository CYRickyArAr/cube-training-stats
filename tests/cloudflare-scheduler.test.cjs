const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const worker=()=>import('../automation/cloudflare/worker.mjs');
const env={GITHUB_TOKEN:'test-only-token'};

test('Cloudflare scheduler only dispatches the fixed workflow after checking active runs',async()=>{
  const {triggerUpdate}=await worker();const requests=[];
  assert.equal(await triggerUpdate(env,async(url,options)=>{
    requests.push({url,options});
    assert.equal(options.headers.Authorization,'Bearer test-only-token');
    assert.ok(url.startsWith('https://api.github.com/repos/CYRickyArAr/cube-training-stats/actions/workflows/pages.yml/'));
    return options.method==='POST'?new Response(null,{status:204}):Response.json({workflow_runs:[]});
  }),'dispatched');
  assert.equal(requests.length,6);assert.equal(requests.at(-1).options.body,JSON.stringify({ref:'main'}));
});
test('active run skips dispatch; missing secret and API errors fail closed without leaking tokens',async()=>{
  const {triggerUpdate}=await worker();let calls=0;
  assert.match(await triggerUpdate(env,async()=>{calls++;return Response.json({workflow_runs:[{id:1}]});}),/^skipped/);
  assert.equal(calls,1);
  await assert.rejects(triggerUpdate({},()=>{throw Error('must not call');}),/Missing GITHUB_TOKEN/);
  await assert.rejects(triggerUpdate(env,async()=>new Response('test-only-token',{status:401})),error=>error.message==='GitHub API HTTP 401');
  await assert.rejects(triggerUpdate(env,async()=>Response.json({})),/Invalid GitHub run list/);
});
test('scheduler uses five-minute Cron and exposes no public endpoint',async()=>{
  const config=JSON.parse(fs.readFileSync(path.join(__dirname,'../automation/cloudflare/wrangler.jsonc'),'utf8'));
  assert.deepEqual(config.triggers.crons,['*/5 * * * *']);assert.equal(config.workers_dev,false);assert.equal(config.preview_urls,false);
  assert.equal((await worker()).default.fetch,undefined);
});
