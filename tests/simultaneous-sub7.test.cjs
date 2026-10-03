'use strict';
// Synthetic data stays in tests. No production records are generated.
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const C=require('../core.js');const root=path.join(__dirname,'..');
const people=['a','b','c'].map(id=>({id,name:id.toUpperCase()}));
const record=(personId,score,sourceRow,date='2026-09-29')=>({id:`${personId}-${sourceRow}-${date}`,personId,score,sourceRow,date,at:date?date+'T00:00:00+08:00':null,note:''});
const round=(scores,row,date)=>scores.map((score,i)=>record(people[i].id,score,row,date));
const fourRounds=()=>[...round([699.99,600,650],2),...round([600,650,700],3),...round([600,700,null],4),...round([null,null,null],5)];
test('simultaneous Sub7 uses observed complete rounds and nested at-least thresholds, not independent probabilities',()=>{
 const records=fourRounds(),before=JSON.stringify(records),r=C.simultaneousSub7(people,records);
 assert.deepEqual(r,{participants:3,rounds:4,skippedRounds:0,unmatchedRecords:0,counts:{1:3,2:2,3:1},rates:{1:75,2:50,3:25}});
 assert.equal(JSON.stringify(records),before);assert.deepEqual(C.simultaneousSub7(people,[...records].reverse()),r);
 assert.ok(r.rates[1]>=r.rates[2]&&r.rates[2]>=r.rates[3]);assert.notEqual(r.rates[3],people.reduce((p,person)=>p*C.analyze(records.filter(r=>r.personId===person.id)).sub7Rate/100,100));
});
test('7.00 does not qualify, raw sub-7 precision does, DNF counts as unsuccessful including all-DNF rounds',()=>{
 assert.deepEqual(C.simultaneousSub7(people,round([699.99,700,null],2)).counts,{1:1,2:0,3:0});
 const r=C.simultaneousSub7(people,round([null,null,null],2));assert.equal(r.rounds,1);assert.deepEqual(r.rates,{1:0,2:0,3:0});
});
test('absence never turns the denominator into a two-person competition or substitutes carried daily means',()=>{
 const records=[...fourRounds(),...round([600,650],6),...round([600,650],7,'2026-09-28'),record('c',500,8,'2026-09-27')];
 const r=C.simultaneousSub7(people,records);assert.equal(r.rounds,4);assert.equal(r.skippedRounds,3);assert.deepEqual(r.rates,{1:75,2:50,3:25});
 assert.equal(C.competition(people,records).rounds,5,'two-person competition still counts its complete day independently');
 const noSamples=C.simultaneousSub7(people,round([600,600],2));assert.equal(noSamples.rounds,0);assert.deepEqual(noSamples.rates,{1:null,2:null,3:null});
});
test('matching requires the same source row AND date, never nth records; undated same-row matches follow all-range policy',()=>{
 const records=[record('a',600,2),record('b',600,3),record('c',600,4),record('a',600,5,'2026-09-28'),record('b',600,5),record('c',600,5)];
 const r=C.simultaneousSub7(people,records);assert.equal(r.rounds,0);assert.equal(r.skippedRounds,5);
 assert.equal(C.simultaneousSub7(people,round([600,600,600],2,null)).rounds,1);
 assert.equal(C.simultaneousSub7(people,[...round([600,600,600],2),...round([600,600,600],2,'2026-09-30')]).rounds,2);
});
test('duplicate or invalid values invalidate the round; absent source rows are counted separately',()=>{
 assert.equal(C.simultaneousSub7(people,[...round([600,600,600],2),record('a',600,2)]).skippedRounds,1);
 for(const value of [NaN,Infinity,undefined,0,-1,'600',false]){const r=C.simultaneousSub7(people,round([600,600,value],2));assert.equal(r.rounds,0);assert.equal(r.skippedRounds,1);}
 for(const row of [undefined,null,1,2.5,'2']){const r=C.simultaneousSub7(people,round([600,600,600],row));assert.equal(r.rounds,0);assert.equal(r.unmatchedRecords,3);}
 const r=C.simultaneousSub7(people,[...fourRounds(),record('outsider',600,2)]);assert.equal(r.rounds,4);assert.deepEqual(r.rates,{1:75,2:50,3:25});
});
test('do not silently choose three people from another roster size, and no data is not zero percent',()=>{
 for(const roster of [[],people.slice(0,1),people.slice(0,2),[...people,{id:'d',name:'D'}]]){const r=C.simultaneousSub7(roster,fourRounds());assert.equal(r.rounds,0);assert.deepEqual(r.rates,{1:null,2:null,3:null});}
 assert.deepEqual(C.simultaneousSub7(people,[]).rates,{1:null,2:null,3:null});
});
test('browser: fun statistics display real fractions and stay inside the comparison panel on desktop and mobile',
 {skip:process.env.CUBE_UI_TEST!=='1',timeout:45000},async()=>{
 const {TencentReader}=require('../tencent-reader.cjs');const browser=new TencentReader();
 try{
  await browser.start();const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link rel="stylesheet"[^>]*>/,()=>'<style>'+fs.readFileSync(path.join(root,'styles.css'),'utf8')+'</style>');
  const frame=(await browser.cdp('Page.getFrameTree')).frameTree.frame.id;await browser.cdp('Page.setDocumentContent',{frameId:frame,html});
  const payload={data:{version:1,people,records:fourRounds(),warnings:[]},lastSuccessAt:new Date().toISOString(),stale:false,error:null};
  await browser.evaluate(fs.readFileSync(path.join(root,'core.js'),'utf8'));await browser.evaluate(`window.fetch=async()=>({ok:true,status:200,json:async()=>(${JSON.stringify(payload)})})`);await browser.evaluate(fs.readFileSync(path.join(root,'app.js'),'utf8'));await browser.evaluate(`new Promise(r=>setTimeout(r,30))`);
  assert.equal(await browser.evaluate(`document.querySelector('.fun-card').getBoundingClientRect().height`),0,'not in personal view');
  await browser.evaluate(`document.querySelector('#comparison-tab').click()`);
  const stats=await browser.evaluate(`({rates:[3,2,1].map(n=>document.querySelector('#fun-sub7-'+n).textContent),counts:[3,2,1].map(n=>document.querySelector('#fun-sub7-'+n+'-count').textContent)})`);assert.deepEqual(stats,{rates:['25.0%','50.0%','75.0%'],counts:['1 / 4 局','2 / 4 局','3 / 4 局']});
  for(const [width,height] of [[1366,768],[768,1024],[390,844],[320,700]]){
   await browser.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<650});
   const layout=await browser.evaluate(`(()=>{const c=document.querySelector('.fun-card'),r=c.getBoundingClientRect();return {inside:document.querySelector('#comparison-panel').contains(c),overflow:document.documentElement.scrollWidth>innerWidth,items:[...c.querySelectorAll('.fun-metric > *')].map(e=>{const b=e.getBoundingClientRect();return {fits:b.left>=r.left&&b.right<=r.right,size:parseFloat(getComputedStyle(e).fontSize),overflow:e.scrollWidth>e.clientWidth}})}})()`);
   assert.equal(layout.inside,true);assert.equal(layout.overflow,false,width+'px page fits');for(const item of layout.items){assert.ok(item.fits,width+'px item fits');assert.equal(item.overflow,false,width+'px text fits');assert.ok(item.size>=14);}
  }
 }finally{await browser.close();}
});
