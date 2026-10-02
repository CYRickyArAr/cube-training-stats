'use strict';
// Synthetic records only: daily means use the entire day's valid ao5 sample.
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const C=require('../core.js');const root=path.join(__dirname,'..');
const make=(score,row,date='2026-10-02',personId='p1')=>({id:`${personId}-${date}-${row}`,personId,score,sourceRow:row,sourceCell:'B'+row,date,at:date?date+'T00:00:00+08:00':null,note:''});
const day=(scores,date,personId='p1')=>scores.map((s,i)=>make(s,i+2,date,personId));
const records=[...day(Array(15).fill(900),'2026-10-01'),...day([...Array(19).fill(700),1100,null,null],'2026-10-02'),make(1100,2,'2026-09-30'),make(600,2,'2026-09-29','p2'),make(900,2,'2026-10-02','p2')].reverse();
test('20 valid groups on Oct 2 compare with all 15 on Oct 1; DNF excluded, raw precision and source preserved',()=>{
 const before=JSON.stringify(records),result=C.dailyComparison(records,'p1','2026-10-02');
 assert.deepEqual(result,{current:{date:'2026-10-02',total:22,valid:20,dnf:2,mean:720},previous:{date:'2026-10-01',total:15,valid:15,dnf:0,mean:900},improvement:20});assert.equal(JSON.stringify(records),before);
 const long=C.dailyComparison([...day([...Array(20).fill(600),...Array(10).fill(1200)],'2026-10-02'),...day(Array(15).fill(1000),'2026-10-01')],'p1','2026-10-02');assert.equal(long.current.mean,800);assert.equal(long.improvement,20,'never truncate to 20 groups');
 const precise=C.dailyComparison([make(699.9,2),make(700.1,2,'2026-10-01')],'p1','2026-10-02');assert.equal(precise.current.mean,699.9);assert.equal(precise.improvement,(700.1-699.9)/700.1*100);
});
test('previous training date belongs to the selected person; gaps skipped, unknown and future dates excluded',()=>{
 const input=[...records,make(1,99,null),make(300,2,'2026-10-03')];
 assert.equal(C.dailyComparison(input,'p1','2026-10-01').previous.date,'2026-09-30');
 const other=C.dailyComparison(input,'p2','2026-10-02');assert.equal(other.previous.date,'2026-09-29');assert.equal(other.improvement,-50);
 const fallback=C.dailyComparison([{...make(800,2,'2026-10-01'),date:null},make(700,2)],'p1','2026-10-02');assert.equal(fallback.previous.date,'2026-10-01');
 const china=C.dailyComparison([{...make(800,2,'2026-10-01'),at:'2026-09-30T16:00:00Z'},make(700,2)],'p1','2026-10-02');assert.equal(china.previous.date,'2026-10-01');
});
test('missing days, earliest date and all-DNF days have no change; do not bypass an all-DNF previous day',()=>{
 const input=[make(600,2),make(null,2,'2026-10-01'),make(800,2,'2026-09-30')];
 const result=C.dailyComparison(input,'p1','2026-10-02');assert.equal(result.previous.date,'2026-10-01');assert.equal(result.previous.mean,null);assert.equal(result.improvement,null);
 for(const date of ['','2026-09-29','2026-09-30','2026-10-01'])assert.equal(C.dailyComparison(input,'p1',date).improvement,null);
 assert.equal(C.dailyComparison([],'p1','2026-10-02').current.total,0);
 assert.equal(C.dailyComparison([make(700,2),make(700,2,'2026-10-01')],'p1','2026-10-02').improvement,0);
});
function boot(initial=records){
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),els=new Map();
 const element=id=>({id,value:id==='range'?'0':'',textContent:'',innerHTML:'',hidden:false,disabled:false,checked:true,attrs:{},listeners:{},classList:{toggle(){}},setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]},addEventListener(k,f){(this.listeners[k]||=[]).push(f)},dispatch(k,event={}){for(const f of this.listeners[k]||[])f({target:this,...event})},querySelector(){return null},scrollTo(){}});
 for(const m of html.matchAll(/\bid="([^"]+)"/g))els.set(m[1],element(m[1]));
 const get=id=>{assert.ok(els.has(id),id);return els.get(id)};const document=element('document');document.querySelector=s=>get(s.slice(1));document.visibilityState='visible';
 let payload={data:{version:1,people:[{id:'p1',name:'Test1'},{id:'p2',name:'Test2'}],records:initial,warnings:[],source:{title:'Test only'}},source:{title:'Test only'},lastSuccessAt:'2026-10-02T04:00:00Z',refreshing:false,stale:false,error:null};
 class Clock extends Date{static now(){return Date.parse('2026-10-02T04:00:00Z')}}
 const sandbox={document,console,CubeStats:C,Date:Clock,setInterval(){},setTimeout,fetch:async()=>({ok:true,status:200,json:async()=>payload})};sandbox.window=sandbox;vm.runInNewContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),sandbox);
 return {get,text:()=>get('analysis').innerHTML,flush:async()=>{for(let i=0;i<12;i++)await Promise.resolve()},person(id){document.dispatch('click',{target:{closest:s=>s==='[data-person]'?{dataset:{person:id}}:null}})},update(records){payload={...payload,data:{...payload.data,records}}},range(mode,date){get('range').value=mode;get('range').dispatch('change');if(date!==undefined){get('range-date').value=date;get('range-date').dispatch('change')}}};
}
test('all ranges show latest training-day means; selecting dates steps backward; other statistics remain range-filtered',async()=>{
 const ui=boot();await ui.flush();
 for(const range of ['0','7','30','90','day']){ui.range(range);assert.match(ui.text(),/均值提升 20.0%/);assert.match(ui.text(),/2026-10-01 9.00 → 2026-10-02 7.20/);assert.doesNotMatch(ui.text(),/40 组|此前 20|最近 20/);}
 assert.equal(ui.get('metric-mean').textContent,'7.20');assert.equal(ui.get('record-count').textContent,22);assert.match(ui.text(),/上次 2026-10-01：15 组有效；本次 2026-10-02：20 组有效/);
 ui.range('day','2026-10-01');assert.match(ui.text(),/2026-09-30 11.00 → 2026-10-01 9.00/);assert.match(ui.text(),/均值提升 18.2%/);assert.equal(ui.get('record-count').textContent,15);
 ui.range('day','2026-10-02');ui.person('p2');assert.match(ui.text(),/2026-09-29 6.00 → 2026-10-02 9.00/);assert.match(ui.text(),/均值变慢 50.0%/);assert.equal(ui.get('record-count').textContent,1);
 ui.person('p1');ui.update([...day(Array(15).fill(900),'2026-10-01'),make(900,2)]);ui.get('refresh-data').dispatch('click');await ui.flush();assert.equal(ui.get('range-date').value,'2026-10-02');assert.match(ui.text(),/日均水平基本持平/);
});
test('date baseline may be outside preset range without importing its records into other metrics',async()=>{
 const ui=boot([make(1000,2,'2026-09-01'),make(600,2)]);await ui.flush();ui.range('7');assert.match(ui.text(),/2026-09-01 10.00 → 2026-10-02 6.00/);assert.match(ui.text(),/均值提升 40.0%/);assert.equal(ui.get('metric-mean').textContent,'6.00');assert.equal(ui.get('record-count').textContent,1);
});
test('day comparison explains no date, no records, earliest date and all-DNF cases without a 40-group requirement',async()=>{
 const ui=boot([make(600,2),make(null,2,'2026-10-01'),make(800,2,'2026-09-30')]);await ui.flush();assert.match(ui.text(),/上次 2026-10-01 只有 DNF/);
 ui.range('day','2026-10-01');assert.match(ui.text(),/2026-10-01 只有 DNF/);ui.range('day','2026-09-30');assert.match(ui.text(),/此前没有训练记录/);ui.range('day','2026-09-29');assert.match(ui.text(),/2026-09-29 没有训练记录/);ui.range('day','');assert.match(ui.text(),/请选择训练日期/);
 ui.update([make(600,2,null)]);ui.get('refresh-data').dispatch('click');await ui.flush();ui.range('0');assert.match(ui.text(),/没有标注日期的训练记录/);assert.doesNotMatch(ui.text(),/40 组/);
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');assert.match(html,/不截取固定组数/);assert.doesNotMatch(html,/最近 40 条/);
});
