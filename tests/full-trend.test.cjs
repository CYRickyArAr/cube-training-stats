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
const count=ui=>Number(ui.chart().match(/data-trend-count="(\d+)"/)?.[1]||0);
test('all 1000 records are rendered in chronological order, without circles or a 120-group cap',async()=>{
 const records=Array.from({length:1000},(_,i)=>make(600+i%30,i+2)).reverse();records.at(-1).note='<script>test</script>';
 const ui=boot(records);await ui.flush();assert.equal(count(ui),1000);assert.equal((pathData(ui).match(/L/g)||[]).length,999);assert.equal((ui.chart().match(/class="trend-hit"/g)||[]).length,1000);
 assert.ok(ui.chart().indexOf(' · B2 ·')<ui.chart().indexOf(' · B1001 ·'));assert.match(ui.chart(),/第 1 组/);assert.match(ui.chart(),/第 1000 组/);assert.match(ui.chart(),/&lt;script&gt;test&lt;\/script&gt;/);assert.doesNotMatch(ui.chart(),/<circle|<script|NaN|Infinity/);assert.doesNotMatch(ui.get('chart-caption').textContent,/最近 120/);
});
test('DNF breaks the path and preserves its slot; isolated valid records are short lines, never false connections',async()=>{
 const ui=boot([600,700,null,650,null,500,550].map((s,i)=>make(s,i+2)));await ui.flush();assert.equal(count(ui),7);
 const groups=pathData(ui).split('M').filter(Boolean).map(s=>[...s.matchAll(/(?:^|L)([\d.]+),([\d.]+)/g)].map(m=>Number(m[1])));
 assert.deepEqual(groups,[[72,182.5],[400.5,406.5],[624.5,735]]);assert.equal((ui.chart().match(/ao5 DNF/g)||[]).length,2);assert.equal((ui.chart().match(/class="trend-hit"/g)||[]).length,7);assert.doesNotMatch(ui.chart(),/<circle|#c43131/);
});
test('single, equal, all-DNF and empty records render honestly without invalid coordinates',async()=>{
 for(const scores of [[600],[600,600],[null],[null,null],[null,600,null],[]]){
  const ui=boot(scores.map((s,i)=>make(s,i+2)));await ui.flush();assert.equal(count(ui),scores.length);assert.doesNotMatch(ui.chart(),/<circle|NaN|Infinity/);
  if(scores.some(s=>s!==null))assert.match(pathData(ui),/^M.* L?/);else assert.equal(pathData(ui),'');
  if(scores.length&&scores.every(s=>s===null))assert.match(ui.chart(),/只有 DNF/);if(!scores.length)assert.match(ui.chart(),/没有训练记录/);
 }
});
test('full trend respects date/range/person filters, preserves mode across refresh and agrees with distribution counts',async()=>{
 const records=[...Array.from({length:200},(_,i)=>make(600,i+2,'2026-09-20')),...Array.from({length:130},(_,i)=>make(700,i+202)),make(500,999,null),make(800,2,'2026-09-30','p2')];
 const ui=boot(records);await ui.flush();assert.equal(count(ui),331);assert.ok(ui.chart().indexOf('日期未标注')<ui.chart().indexOf('2026-09-20 · B2'));
 ui.range('day','2026-09-30');assert.equal(count(ui),130);ui.range('7');assert.equal(count(ui),130);
 ui.get('histogram-chart-tab').dispatch('click');assert.equal([...ui.chart().matchAll(/data-count="(\d+)"/g)].reduce((sum,m)=>sum+Number(m[1]),0),130);ui.get('trend-chart-tab').dispatch('click');assert.equal(count(ui),130);
 ui.person('p2');assert.equal(count(ui),1);ui.update([make(600,2,'2026-09-30','p2'),make(650,3,'2026-09-30','p2')]);ui.get('refresh-data').dispatch('click');await ui.flush();assert.equal(count(ui),2);assert.equal(ui.get('trend-chart-tab').attrs['aria-pressed'],true);
});
