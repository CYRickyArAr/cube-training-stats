'use strict';
// Test-only source responses; production continues to use Tencent snapshots only.
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const C=require('../core.js');const root=path.join(__dirname,'..');
const make=(id,personId,date,score)=>({id,personId,date,score,at:date?date+'T00:00:00+08:00':null,sourceRow:Number(id.replace(/\D/g,''))+2,sourceCell:'B2',note:''});
const records=[make('r1','p1','2026-09-20',1000),make('r2','p1','2026-09-21',600),make('r3','p1','2026-09-21',null),make('r4','p1','2026-09-30',700),make('r5','p1',null,400),make('r6','p2','2026-09-21',800)];
function boot(storage=new Map()){
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),els=new Map();
 const element=id=>({id,value:id==='range'?'0':'',textContent:'',innerHTML:'',hidden:false,disabled:false,checked:true,attrs:{},listeners:{},classList:{toggle(){}},setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]},addEventListener(k,f){(this.listeners[k]||=[]).push(f)},dispatch(k,extra={}){for(const f of this.listeners[k]||[])f({target:this,...extra})},focus(){this.focused=true},querySelector(){return null},scrollTo(){}});
 for(const m of html.matchAll(/\bid="([^"]+)"/g))els.set(m[1],element(m[1]));
 const get=id=>{assert.ok(els.has(id),'production DOM missing #'+id);return els.get(id)};
 const document=element('document');document.querySelector=s=>get(s.slice(1));document.visibilityState='visible';
 let current={data:{version:1,people:[{id:'p1',name:'test1'},{id:'p2',name:'test2'}],records,warnings:[],source:{title:'Test only'}},source:{title:'Test only'},lastSuccessAt:'2026-09-30T04:00:00Z',refreshing:false,stale:false,error:null};
 class Clock extends Date{static now(){return Date.parse('2026-09-30T04:00:00Z')}}
 const sandbox={document,console,CubeStats:C,Date:Clock,sessionStorage:{getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)},setInterval(){},setTimeout,fetch:async()=>({ok:true,status:200,json:async()=>current})};sandbox.window=sandbox;
 vm.runInNewContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),sandbox);
 return {get,flush:async()=>{for(let i=0;i<12;i++)await Promise.resolve()},person(id){document.dispatch('click',{target:{closest:s=>s==='[data-person]'?{dataset:{person:id}}:null}})},update(r){current={...current,data:{...current.data,records:r}}},pick(date,disabled=false){const button={dataset:{calendarDate:date},disabled};let detached=false;const target={closest:s=>detached?null:s==='[data-calendar-date]'?button:s==='.date-picker-slot'?{}:null};const event={target,composedPath:()=>[button,get('calendar-days'),get('date-calendar')]};get('calendar-days').dispatch('click',event);detached=true;document.dispatch('click',event);},outside(){document.dispatch('click',{target:{closest:()=>null}})},inside(){document.dispatch('click',{target:{closest:s=>s==='.date-picker-slot'?{}:null}})},escape(){document.dispatch('keydown',{key:'Escape',preventDefault(){}})},viewport(width,height,rect){sandbox.innerWidth=width;sandbox.innerHeight=height;get('range-date').getBoundingClientRect=()=>rect;const popup=get('date-calendar');popup.offsetWidth=Math.min(320,width-24);popup.offsetHeight=320;popup.style={};}};
}
test('calendar picks a specific China training date; metrics, history and comparison all use that day',async()=>{
 const ui=boot();await ui.flush();const date=ui.get('range-date');assert.equal(date.hidden,true);
 ui.get('range').value='day';ui.get('range').dispatch('change');assert.equal(date.hidden,false);assert.equal(date.value,'2026-09-30','default to latest dated source training day');assert.equal(date.min,'2026-09-20');assert.equal(date.max,'2026-09-30');assert.equal(ui.get('date-calendar').hidden,false,'opening specific day opens the page calendar');
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
test('refresh button and full page reload retain the selected day without storing any score data',async()=>{
 const storage=new Map(),ui=boot(storage);await ui.flush();ui.get('range').value='day';ui.get('range').dispatch('change');ui.pick('2026-09-21');
 assert.deepEqual(JSON.parse(storage.get('cube-stats-filter-v1')),{range:'day',date:'2026-09-21'});assert.equal(storage.size,1,'only filter preferences are stored');
 ui.get('refresh-data').dispatch('click');await ui.flush();assert.equal(ui.get('range').value,'day');assert.equal(ui.get('range-date').value,'2026-09-21');assert.equal(ui.get('record-count').textContent,2);
 const reloaded=boot(storage);assert.equal(reloaded.get('range').value,'day','filter restored before remote response');assert.equal(reloaded.get('range-date').value,'2026-09-21');await reloaded.flush();assert.equal(reloaded.get('record-count').textContent,2);assert.equal(reloaded.get('metric-sub7').textContent,'50.0%');assert.equal(reloaded.get('date-calendar').hidden,true,'page reload does not automatically open popup');
 reloaded.get('range-date').dispatch('click');reloaded.pick('2026-09-22');const emptyDay=boot(storage);emptyDay.update([make('latest','p1','2026-09-30',500)]);await emptyDay.flush();assert.equal(emptyDay.get('range-date').value,'2026-09-22');assert.equal(emptyDay.get('record-count').textContent,0,'missing day must not silently switch to all or latest data');
});
test('preset ranges and an explicitly cleared date survive full page reload',async()=>{
 const storage=new Map();let ui=boot(storage);await ui.flush();
 for(const range of ['7','30','90','0']){ui.get('range').value=range;ui.get('range').dispatch('change');ui=boot(storage);await ui.flush();assert.equal(ui.get('range').value,range);assert.equal(ui.get('range-date').hidden,true);}
 ui.get('range').value='day';ui.get('range').dispatch('change');ui.get('calendar-clear').dispatch('click');ui=boot(storage);await ui.flush();assert.equal(ui.get('range').value,'day');assert.equal(ui.get('range-date').value,'');assert.equal(ui.get('record-count').textContent,0,'explicit clearing is not replaced by latest date on reload');
});
test('invalid saved preferences and blocked session storage do not prevent fresh remote reads',async()=>{
 for(const value of ['{broken',JSON.stringify({range:'invalid',date:''}),JSON.stringify({range:'day',date:'2026-02-30'}),JSON.stringify({range:'day',date:'2026-9-21'}),JSON.stringify({range:'day',date:123})]){const storage=new Map([['cube-stats-filter-v1',value]]),ui=boot(storage);await ui.flush();assert.equal(ui.get('range').value,'0');assert.equal(ui.get('range-date').hidden,true);assert.equal(ui.get('record-count').textContent,5);}
 const blocked={get(){throw Error('denied')},set(){throw Error('denied')}};const ui=boot(blocked);await ui.flush();ui.get('range').value='day';ui.get('range').dispatch('change');ui.pick('2026-09-21');assert.equal(ui.get('record-count').textContent,2);assert.equal(ui.get('date-calendar').hidden,false);ui.get('refresh-data').dispatch('click');await ui.flush();assert.equal(ui.get('range-date').value,'2026-09-21');
});
test('non-day ranges collapse the whole calendar slot rather than leaving a blank grid row',()=>{
 const css=fs.readFileSync(path.join(root,'styles.css'),'utf8');
 assert.match(css,/\.date-picker-slot:has\(input\[hidden\]\)\{display:none\}/);
 assert.match(css,/\.range-controls\{display:grid;grid-auto-rows:32px;/);
 assert.match(css,/\.page-heading>\.range-label\{height:auto;/);
 assert.match(css,/grid-template-rows:62px 42px auto;/);
 assert.doesNotMatch(css,/grid-template-rows:32px 32px|\.page-heading>\.range-label\{height:68px/);
});
test('page calendar prevents the native auto-dismiss picker, without a generated date select list',()=>{const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),app=fs.readFileSync(path.join(root,'app.js'),'utf8');assert.match(html,/<option value="day">指定日期<\/option>/);assert.match(html,/<input[^>]*id="range-date"[^>]*type="date"[^>]*readonly[^>]*aria-haspopup="dialog"/);assert.match(html,/id="date-calendar"[^>]*role="dialog"/);assert.equal([...html.matchAll(/<option /g)].length,5);assert.doesNotMatch(html,/<datalist/);assert.doesNotMatch(app,/showPicker/);});
test('choosing multiple dates, clearing and Today keep the calendar open; outside click and Escape close it',async()=>{
 const ui=boot();await ui.flush();ui.get('range').value='day';ui.get('range').dispatch('change');
 assert.equal(ui.get('range-date').attrs['aria-expanded'],'true');assert.equal(ui.get('calendar-month').textContent,'2026年9月');
 ui.pick('2026-09-21');assert.equal(ui.get('date-calendar').hidden,false);assert.equal(ui.get('record-count').textContent,2);assert.equal(ui.get('metric-sub7').textContent,'50.0%');assert.match(ui.get('calendar-days').innerHTML,/data-calendar-date="2026-09-21" class="selected has-records"/);
 ui.pick('2026-09-22');assert.equal(ui.get('date-calendar').hidden,false);assert.equal(ui.get('record-count').textContent,0);
 ui.inside();assert.equal(ui.get('date-calendar').hidden,false,'clicking popup background never dismisses it');
 ui.get('calendar-clear').dispatch('click');assert.equal(ui.get('range-date').value,'');assert.equal(ui.get('date-calendar').hidden,false);
 ui.get('calendar-today').dispatch('click');assert.equal(ui.get('range-date').value,'2026-09-30');assert.equal(ui.get('date-calendar').hidden,false);
 ui.get('refresh-data').dispatch('click');await ui.flush();assert.equal(ui.get('date-calendar').hidden,false,'auto/manual render does not dismiss popup');
 ui.outside();assert.equal(ui.get('date-calendar').hidden,true);assert.equal(ui.get('range-date').attrs['aria-expanded'],'false');assert.equal(ui.get('range-date').value,'2026-09-30');
 ui.get('range-date').dispatch('click');assert.equal(ui.get('date-calendar').hidden,false);ui.escape();assert.equal(ui.get('date-calendar').hidden,true);assert.equal(ui.get('range-date').focused,true);
 ui.get('range-date').dispatch('keydown',{key:'Enter',preventDefault(){}});assert.equal(ui.get('date-calendar').hidden,false);
 ui.get('range').value='7';ui.get('range').dispatch('change');assert.equal(ui.get('date-calendar').hidden,true);assert.equal(ui.get('range-date').hidden,true);
});
test('calendar navigation respects source bounds, leap days and disabled dates, while staying open',async()=>{
 const ui=boot();await ui.flush();ui.update([make('a1','p1','2024-02-28',600),make('a2','p1','2024-03-01',700)]);ui.get('refresh-data').dispatch('click');await ui.flush();
 ui.get('range').value='day';ui.get('range').dispatch('change');assert.equal(ui.get('calendar-month').textContent,'2024年3月');assert.equal(ui.get('calendar-next').disabled,true);assert.equal(ui.get('calendar-today').disabled,true);
 ui.get('calendar-prev').dispatch('click');assert.equal(ui.get('calendar-month').textContent,'2024年2月');assert.equal(ui.get('calendar-prev').disabled,true);assert.equal(ui.get('date-calendar').hidden,false);
 assert.match(ui.get('calendar-days').innerHTML,/data-calendar-date="2024-02-29"[^>]*>29<\/button>/);assert.equal([...ui.get('calendar-days').innerHTML.matchAll(/data-calendar-date=/g)].length,42);
 ui.pick('2024-02-29');assert.equal(ui.get('range-date').value,'2024-02-29');assert.equal(ui.get('record-count').textContent,0);assert.equal(ui.get('date-calendar').hidden,false);
 ui.pick('2024-02-27',true);assert.equal(ui.get('range-date').value,'2024-02-29');ui.pick('2024-02-27');assert.equal(ui.get('range-date').value,'2024-02-29','range validation rejects out-of-range dates');
 ui.get('calendar-next').dispatch('click');assert.equal(ui.get('calendar-month').textContent,'2024年3月');assert.equal(ui.get('date-calendar').hidden,false);
 ui.get('calendar-days').dispatch('keydown',{key:'ArrowLeft',preventDefault(){},target:{closest:()=>({dataset:{calendarDate:'2024-03-01'}})}});assert.equal(ui.get('calendar-month').textContent,'2024年2月');assert.equal(ui.get('range-date').value,'2024-02-29','arrow navigation only moves focus, not selected date');
});
test('calendar fits the viewport and flips upward when there is no space below',async()=>{
 const ui=boot();await ui.flush();ui.viewport(390,844,{right:375,top:200,bottom:232});ui.get('range').value='day';ui.get('range').dispatch('change');assert.equal(ui.get('date-calendar').style.left,'55px');assert.equal(ui.get('date-calendar').style.top,'238px');
 ui.viewport(390,844,{right:375,top:700,bottom:732});ui.get('range-date').dispatch('click');assert.equal(ui.get('date-calendar').style.top,'374px');
 ui.viewport(280,600,{right:265,top:100,bottom:132});ui.get('range-date').dispatch('click');assert.equal(ui.get('date-calendar').style.left,'12px');
});
