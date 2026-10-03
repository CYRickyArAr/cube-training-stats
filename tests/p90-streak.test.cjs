'use strict';
// Synthetic records only; production continues to read Tencent exclusively.
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const C=require('../core.js');const root=path.join(__dirname,'..');
const make=(score,row,date='2026-09-29',personId='p1')=>({id:`${personId}-${date}-${row}`,personId,score,sourceRow:row,sourceCell:'B'+row,date,at:date?date+'T00:00:00+08:00':null,note:''});
const metric=(ui,id)=>{const match=ui.get('analysis').innerHTML.match(new RegExp(`id="${id}">([^<]*)`));assert.ok(match,id);return match[1]};
test('P90 uses nearest rank of all valid raw times, excludes DNF, and preserves the source',()=>{
 const records=Array.from({length:20},(_,i)=>make(600+i*.1,i+2));records.push(make(null,30));records.reverse();const before=JSON.stringify(records);
 assert.equal(C.analyze(records).p90,601.7);assert.equal(JSON.stringify(records),before);
 for(const n of [1,2,9,10,11,19,20,21,100]){const stats=C.analyze(Array.from({length:n},(_,i)=>make(i+1,i+2)));assert.equal(stats.p90,Math.ceil(.9*n));}
 assert.equal(C.analyze([]).p90,null);assert.equal(C.analyze([make(null,2)]).p90,null);
 assert.equal(C.analyze([make(699.9,2)]).p90,699.9);
});
test('longest Sub7 is chronological, retains DNF breaks and original precision, and distinguishes no data from zero',()=>{
 const records=[600,699.9,null,600,700,600,699.99,650,800,600].map((score,i)=>make(score,i+2)).reverse();
 assert.equal(C.analyze(records).longestSub7,3);assert.equal(C.analyze([]).longestSub7,null);
 assert.equal(C.analyze([make(null,2),make(700,3)]).longestSub7,0);
 assert.equal(C.analyze([make(699.9,2)]).longestSub7,1);
 assert.equal(C.analyze([make(600,3,'2026-09-30'),make(600,2,'2026-09-29')]).longestSub7,2,'consecutive recorded attempts may cross dates');
});
function boot(records){
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),els=new Map();
 const element=id=>({id,value:id==='range'?'0':'',textContent:'',innerHTML:'',hidden:false,disabled:false,checked:true,attrs:{},listeners:{},classList:{toggle(){}},setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]},addEventListener(k,f){(this.listeners[k]||=[]).push(f)},dispatch(k,event={}){for(const f of this.listeners[k]||[])f({target:this,...event})},querySelector(){return null},scrollTo(){}});
 for(const m of html.matchAll(/\bid="([^"]+)"/g))els.set(m[1],element(m[1]));
 const get=id=>{assert.ok(els.has(id),id);return els.get(id)};const document=element('document');document.querySelector=s=>get(s.slice(1));document.visibilityState='visible';
 let payload={data:{version:1,people:[{id:'p1',name:'Test1'},{id:'p2',name:'Test2'}],records,warnings:[],source:{title:'Test only'}},source:{title:'Test only'},lastSuccessAt:'2026-09-30T04:00:00Z',refreshing:false,stale:false,error:null};
 class Clock extends Date{static now(){return Date.parse('2026-09-30T04:00:00Z')}}
 const sandbox={document,console,CubeStats:C,Date:Clock,setInterval(){},setTimeout,fetch:async()=>({ok:true,status:200,json:async()=>payload})};sandbox.window=sandbox;
 vm.runInNewContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),sandbox);
 return {get,flush:async()=>{for(let i=0;i<12;i++)await Promise.resolve()},person(id){document.dispatch('click',{target:{closest:s=>s==='[data-person]'?{dataset:{person:id}}:null}})},update(records){payload={...payload,data:{...payload.data,records}}},range(mode,date){get('range').value=mode;get('range').dispatch('change');if(date){get('range-date').value=date;get('range-date').dispatch('change')}}};
}
test('analysis replaces DNF ratio with P90 and longest Sub7, following range, source order, person and refresh',async()=>{
 const records=[make(600,99,null),make(null,2,'2026-09-20'),...[699.9,600,700,650].map((s,i)=>make(s,i+3)),make(650,7,'2026-09-30'),make(650,8,'2026-09-30'),make(800,3,'2026-09-29','p2')].reverse();
 const ui=boot(records);await ui.flush();assert.equal(metric(ui,'analysis-p90'),'7.00');assert.equal(metric(ui,'analysis-sub7-streak'),'3 组');assert.doesNotMatch(ui.get('analysis').innerHTML,/DNF 占比|有效率|有效组 \/ DNF/);assert.match(ui.get('analysis').innerHTML,/不足 10 组/);
 ui.range('day','2026-09-29');assert.equal(metric(ui,'analysis-p90'),'7.00');assert.equal(metric(ui,'analysis-sub7-streak'),'2 组');
 ui.person('p2');assert.equal(metric(ui,'analysis-p90'),'8.00');assert.equal(metric(ui,'analysis-sub7-streak'),'0 组');ui.person('p1');
 ui.range('day','2026-09-20');assert.equal(metric(ui,'analysis-p90'),'—');assert.equal(metric(ui,'analysis-sub7-streak'),'0 组');
 ui.range('day','2026-09-21');assert.equal(metric(ui,'analysis-p90'),'—');assert.equal(metric(ui,'analysis-sub7-streak'),'—');
 ui.range('day','2026-09-29');ui.update([make(800,3)]);ui.get('refresh-data').dispatch('click');await ui.flush();assert.equal(ui.get('range-date').value,'2026-09-29');assert.equal(metric(ui,'analysis-p90'),'8.00');assert.equal(metric(ui,'analysis-sub7-streak'),'0 组');
 ui.update([...records,make(1200,2,'2026-08-01')]);ui.get('refresh-data').dispatch('click');await ui.flush();ui.range('0');assert.equal(metric(ui,'analysis-p90'),'12.00');ui.range('7');assert.equal(metric(ui,'analysis-p90'),'7.00');assert.equal(metric(ui,'analysis-sub7-streak'),'3 组');
});
test('top median and lower standard deviation follow date/person filters, DNF, empty data and refresh',async()=>{
 const ui=boot([make(600,2),make(800,3),make(null,4),make(1000,5,'2026-09-30'),make(null,2,'2026-09-28'),make(650,2,'2026-09-29','p2')]);await ui.flush();
 assert.equal(ui.get('metric-median').textContent,'8.00');assert.equal(metric(ui,'analysis-std'),C.formatScore(C.analyze([{score:600},{score:800},{score:1000}]).std));
 ui.range('day','2026-09-29');assert.equal(ui.get('metric-median').textContent,'7.00');assert.equal(metric(ui,'analysis-std'),'1.00');
 ui.person('p2');assert.equal(ui.get('metric-median').textContent,'6.50');assert.equal(metric(ui,'analysis-std'),'—');assert.match(ui.get('analysis').innerHTML,/至少 2 组有效 ao5/);
 ui.range('day','2026-09-30');assert.equal(ui.get('metric-median').textContent,'—');assert.equal(metric(ui,'analysis-std'),'—');
 ui.person('p1');ui.range('day','2026-09-28');assert.equal(ui.get('metric-median').textContent,'—');assert.equal(metric(ui,'analysis-std'),'—');
 ui.range('day','2026-09-29');ui.update([make(700,2),make(900,3),make(1100,4)]);ui.get('refresh-data').dispatch('click');await ui.flush();assert.equal(ui.get('range-date').value,'2026-09-29');assert.equal(ui.get('metric-median').textContent,'9.00');assert.equal(metric(ui,'analysis-std'),'1.63');
});
test('unknown dates sort before known dates without joining a streak across DNF',async()=>{
 const ui=boot([make(600,2),make(600,3),make(null,99,null)]);await ui.flush();assert.equal(metric(ui,'analysis-sub7-streak'),'2 组');
 const large=boot([...Array.from({length:121},(_,i)=>make(600,i+2)),make(2000,123)]);await large.flush();assert.equal(metric(large,'analysis-sub7-streak'),'121 组');assert.equal(metric(large,'analysis-p90'),'6.00');assert.doesNotMatch(large.get('analysis').innerHTML,/不足 10 组/);
});
