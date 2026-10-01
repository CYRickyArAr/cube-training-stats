'use strict';
// Test-only source responses; production continues to use Tencent snapshots only.
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const C=require('../core.js');const root=path.join(__dirname,'..');
const make=(id,personId,date,score)=>({id,personId,date,score,at:date?date+'T00:00:00+08:00':null,sourceRow:Number(id.replace(/\D/g,''))+2,sourceCell:'B2',note:''});
const records=[make('r1','p1','2026-09-20',1000),make('r2','p1','2026-09-21',600),make('r3','p1','2026-09-21',null),make('r4','p1','2026-09-30',700),make('r5','p1',null,400),make('r6','p2','2026-09-21',800)];
function boot(){
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),els=new Map();
 const element=id=>({id,value:id==='range'?'0':'',textContent:'',innerHTML:'',hidden:false,disabled:false,checked:true,attrs:{},listeners:{},classList:{toggle(){}},setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]},addEventListener(k,f){(this.listeners[k]||=[]).push(f)},dispatch(k,extra={}){for(const f of this.listeners[k]||[])f({target:this,...extra})},focus(){this.focused=true},showPicker(){this.pickerOpened=true},querySelector(){return null},scrollTo(){}});
 for(const m of html.matchAll(/\bid="([^"]+)"/g))els.set(m[1],element(m[1]));
 const get=id=>{assert.ok(els.has(id),'production DOM missing #'+id);return els.get(id)};
 const document=element('document');document.querySelector=s=>get(s.slice(1));document.visibilityState='visible';
 let current={data:{version:1,people:[{id:'p1',name:'test1'},{id:'p2',name:'test2'}],records,warnings:[],source:{title:'Test only'}},source:{title:'Test only'},lastSuccessAt:'2026-09-30T04:00:00Z',refreshing:false,stale:false,error:null};
 class Clock extends Date{static now(){return Date.parse('2026-09-30T04:00:00Z')}}
 const sandbox={document,console,CubeStats:C,Date:Clock,setInterval(){},setTimeout,fetch:async()=>({ok:true,status:200,json:async()=>current})};sandbox.window=sandbox;
 vm.runInNewContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),sandbox);
 return {get,flush:async()=>{for(let i=0;i<12;i++)await Promise.resolve()},person(id){document.dispatch('click',{target:{closest:()=>({dataset:{person:id}})}})},update(r){current={...current,data:{...current.data,records:r}}}};
}
test('calendar picks a specific China training date; metrics, history and comparison all use that day',async()=>{
 const ui=boot();await ui.flush();const date=ui.get('range-date');assert.equal(date.hidden,true);
 ui.get('range').value='day';ui.get('range').dispatch('change');assert.equal(date.hidden,false);assert.equal(date.value,'2026-09-30','default to latest dated source training day');assert.equal(date.min,'2026-09-20');assert.equal(date.max,'2026-09-30');assert.equal(date.pickerOpened,true,'opening specific day opens the native calendar');
 date.value='2026-09-21';date.dispatch('change');
 assert.equal(ui.get('metric-best').textContent,'6.00');assert.equal(ui.get('metric-sub7').textContent,'50.0%');assert.equal(ui.get('record-count').textContent,2);assert.match(ui.get('records-body').innerHTML,/r2|r3/);assert.doesNotMatch(ui.get('records-body').innerHTML,/data-record="(?:r1|r4|r5)"/);
 ui.get('comparison-tab').dispatch('click');assert.match(ui.get('comparison-body').innerHTML,/6\.00/);assert.match(ui.get('comparison-body').innerHTML,/8\.00/);
 ui.person('p2');assert.equal(date.value,'2026-09-21','person switch preserves selected date');assert.equal(ui.get('metric-best').textContent,'8.00');
 ui.get('refresh-data').dispatch('click');await ui.flush();assert.equal(date.value,'2026-09-21','refresh preserves selected date');
 date.value='2026-09-22';date.dispatch('change');assert.equal(ui.get('record-count').textContent,0);assert.equal(ui.get('metric-best').textContent,'—');
 date.value='';date.dispatch('change');assert.equal(ui.get('record-count').textContent,0,'clearing date cannot include all records');
 ui.get('range').value='0';ui.get('range').dispatch('change');assert.equal(date.hidden,true);assert.equal(ui.get('record-count').textContent,1);
 ui.person('p1');assert.equal(ui.get('record-count').textContent,5,'All records retains unknown-date records');
});
test('calendar is a native date picker, not a generated long date list',()=>{const html=fs.readFileSync(path.join(root,'index.html'),'utf8');assert.match(html,/<option value="day">指定日期<\/option>/);assert.match(html,/<input[^>]*id="range-date"[^>]*type="date"/);assert.equal([...html.matchAll(/<option /g)].length,5,'only four preset ranges plus specific day');assert.doesNotMatch(html,/<datalist/);});
