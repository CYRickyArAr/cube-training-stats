'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const C=require('../core.js');const root=path.join(__dirname,'..');
const make=(score,row,date='2026-09-30',personId='p1')=>({id:`${personId}-${date}-${row}`,personId,score,sourceRow:row,sourceCell:'B'+row,date,at:date?date+'T00:00:00+08:00':null,note:''});
function boot(records){
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),els=new Map();
 const element=id=>({id,value:id==='range'?'0':'',textContent:'',innerHTML:'',hidden:false,disabled:false,checked:true,attrs:{},listeners:{},classList:{toggle(){}},setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]},addEventListener(k,f){(this.listeners[k]||=[]).push(f)},dispatch(k,event={}){for(const f of this.listeners[k]||[])f({target:this,...event})},querySelector(){return null},scrollTo(){}});
 for(const m of html.matchAll(/\bid="([^"]+)"/g))els.set(m[1],element(m[1]));const get=id=>{assert.ok(els.has(id),id);return els.get(id)};
 const document=element('document');document.querySelector=s=>get(s.slice(1));document.visibilityState='visible';
 let payload={data:{version:1,people:[{id:'p1',name:'Test1'},{id:'p2',name:'Test2'}],records,warnings:[],source:{title:'Test only'}},source:{title:'Test only'},lastSuccessAt:'2026-09-30T04:00:00Z',refreshing:false,stale:false,error:null};
 class Clock extends Date{static now(){return Date.parse('2026-09-30T04:00:00Z')}}
 const sandbox={document,console,CubeStats:C,Date:Clock,setInterval(){},setTimeout,fetch:async()=>({ok:true,status:200,json:async()=>payload})};sandbox.window=sandbox;vm.runInNewContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),sandbox);
 return {get,chart:()=>get('chart').innerHTML,flush:async()=>{for(let i=0;i<12;i++)await Promise.resolve()},person(id){document.dispatch('click',{target:{closest:s=>s==='[data-person]'?{dataset:{person:id}}:null}})},update(records){payload={...payload,data:{...payload.data,records}}},range(mode,date){get('range').value=mode;get('range').dispatch('change');if(date){get('range-date').value=date;get('range-date').dispatch('change')}}};
}
const pathData=ui=>ui.chart().match(/class="trend-line" d="([^"]+)"/)?.[1]||'';
const count=ui=>Number(ui.chart().match(/data-trend-days="(\d+)"/)?.[1]||0);
test('daily trend uses every valid raw score per source date, preserves DNF days and excludes unknown dates without modifying records',()=>{
 const records=[make(699.9,2,'2026-09-29'),make(700,3,'2026-09-29'),make(null,4,'2026-09-29'),make(800,2),make(null,3),make(null,2,'2026-09-28'),make(500,99,null)].reverse();const before=JSON.stringify(records);
 assert.deepEqual(C.dailyTrend(records),{days:[{date:'2026-09-28',total:1,valid:0,dnf:1,mean:null},{date:'2026-09-29',total:3,valid:2,dnf:1,mean:699.95},{date:'2026-09-30',total:2,valid:1,dnf:1,mean:800}],undatedRecords:1});assert.equal(JSON.stringify(records),before);
 assert.equal(C.dailyTrend([{...make(600,2,'2026-09-30'),at:'2026-09-29T16:00:00Z'}]).days[0].date,'2026-09-30','source calendar date wins over UTC timestamp');
 assert.equal(C.dailyTrend([{...make(600,2,'2026-09-30'),date:null}]).days[0].date,'2026-09-30','timestamp fallback matches source date filtering');
 assert.deepEqual(C.dailyTrend([]),{days:[],undatedRecords:0});assert.equal(C.dailyTrend([make(999900,2)]).days[0].mean,999900,'do not remove large valid times');
});
test('many records on one day become one daily mean, while all 130 training days remain plotted without dots',async()=>{
 const records=Array.from({length:1000},(_,i)=>make(600+i%30,i+2)).reverse();const ui=boot(records);await ui.flush();assert.equal(count(ui),1);assert.equal((ui.chart().match(/class="trend-hit"/g)||[]).length,1);assert.match(ui.chart(),/1000 组有效 \/ 0 组 DNF · 共 1000 组/);assert.match(ui.chart(),/均值 /);assert.match(ui.chart(),/2026-09-30/);assert.doesNotMatch(ui.chart(),/<circle|第 \d+ 组|NaN|Infinity/);
 const manyDays=Array.from({length:130},(_,i)=>make(600+i%30,i+2,new Date(Date.UTC(2026,0,i+1)).toISOString().slice(0,10))).reverse();const large=boot(manyDays);await large.flush();assert.equal(count(large),130);assert.equal((pathData(large).match(/L/g)||[]).length,129);assert.equal((large.chart().match(/class="trend-hit"/g)||[]).length,130);assert.ok(large.chart().indexOf('data-date="2026-01-01"')<large.chart().indexOf('data-date="2026-05-10"'));assert.doesNotMatch(large.get('chart-caption').textContent,/最近 120/);
});
test('only all-DNF days break the line; mixed days use valid means and missing calendar dates are not invented',async()=>{
 const records=[600,700,null,650,null,500,550].flatMap((s,i)=>[make(s,2,`2026-09-${String(i+20).padStart(2,'0')}`),make(null,3,`2026-09-${String(i+20).padStart(2,'0')}`)]);
 const ui=boot(records);await ui.flush();assert.equal(count(ui),7);
 const groups=pathData(ui).split('M').filter(Boolean).map(s=>[...s.matchAll(/(?:^|L)([\d.]+),([\d.]+)/g)].map(m=>Number(m[1])));assert.deepEqual(groups,[[72,182.5],[400.5,406.5],[624.5,735]]);assert.equal((ui.chart().match(/data-mean=""/g)||[]).length,2);assert.doesNotMatch(ui.chart(),/<circle|#c43131/);
 const sparse=boot([make(600,2,'2026-09-01'),make(700,2,'2026-09-30')]);await sparse.flush();assert.equal(count(sparse),2);assert.equal((pathData(sparse).match(/L/g)||[]).length,1);
});
test('single, equal, all-DNF, undated and empty daily samples render honestly',async()=>{
 for(const scores of [[600],[600,600],[null],[null,null],[null,600,null],[]]){
  const ui=boot(scores.map((s,i)=>make(s,i+2)));await ui.flush();assert.equal(count(ui),scores.length?1:0);assert.doesNotMatch(ui.chart(),/<circle|NaN|Infinity/);
  if(scores.some(s=>s!==null))assert.match(pathData(ui),/^M.* L/);else assert.equal(pathData(ui),'');
  if(scores.length&&scores.every(s=>s===null))assert.match(ui.chart(),/只有 DNF/);if(!scores.length)assert.match(ui.chart(),/没有训练记录/);
 }
 const unknown=boot([make(600,2,null)]);await unknown.flush();assert.equal(count(unknown),0);assert.match(unknown.chart(),/没有可用训练日期/);assert.match(unknown.get('chart-caption').textContent,/1 组日期未标注/);assert.equal(unknown.get('metric-mean').textContent,'6.00','undated score remains in all-range metrics');
});
test('daily trend follows date/person/range filters; distribution and personal metrics still use individual records',async()=>{
 const records=[...Array.from({length:200},(_,i)=>make(600,i+2,'2026-09-20')),...Array.from({length:130},(_,i)=>make(700,i+202)),make(500,999,null),make(800,2,'2026-09-30','p2')];
 const ui=boot(records);await ui.flush();assert.equal(count(ui),2);assert.match(ui.get('chart-caption').textContent,/1 组日期未标注/);assert.equal(ui.get('record-count').textContent,331);
 ui.range('day','2026-09-30');assert.equal(count(ui),1);assert.match(ui.chart(),/data-mean="700"/);assert.equal(ui.get('metric-mean').textContent,'7.00');ui.range('7');assert.equal(count(ui),1);
 ui.get('histogram-chart-tab').dispatch('click');assert.equal([...ui.chart().matchAll(/data-count="(\d+)"/g)].reduce((sum,m)=>sum+Number(m[1]),0),130);ui.get('trend-chart-tab').dispatch('click');assert.equal(count(ui),1);
 ui.person('p2');assert.equal(count(ui),1);assert.match(ui.chart(),/data-mean="800"/);ui.update([make(600,2,'2026-09-30','p2'),make(650,3,'2026-09-30','p2')]);ui.get('refresh-data').dispatch('click');await ui.flush();assert.equal(count(ui),1);assert.match(ui.chart(),/data-mean="625"/);assert.equal(ui.get('trend-chart-tab').attrs['aria-pressed'],true);
});
