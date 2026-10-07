'use strict';
// Synthetic rounds are test-only; production still reads Tencent data exclusively.
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const C=require('../core.js');
const root=path.join(__dirname,'..');
const people=n=>Array.from({length:n},(_,i)=>({id:String.fromCharCode(97+i),name:String.fromCharCode(65+i)}));
const record=(personId,score,sourceRow,date='2026-09-29')=>({id:`${personId}-${sourceRow}-${date}`,personId,score,sourceRow,date,at:date?date+'T00:00:00+08:00':null,sourceCell:'B'+sourceRow,note:''});
const round=(scores,row,date)=>scores.map((score,i)=>record(String.fromCharCode(97+i),score,row,date));
test('three people earn 2/1/0 per complete source row, with partial rounds skipped',()=>{
 const records=[...round([600,700,800],2),...round([800,600,700],3),...round([500,550],4)];
 const before=JSON.stringify(records),result=C.competition(people(3),records);
 assert.deepEqual(result,{participants:3,participantCounts:[3],rounds:2,skippedRounds:1,unmatchedRecords:0,points:{a:2,b:3,c:1},roundsByPerson:{a:2,b:2,c:2}});
 assert.equal(JSON.stringify(records),before,'score calculation never edits source records');
});
test('two people earn 1/0 and N-person matches use N minus rank',()=>{
 assert.deepEqual(C.competition(people(2),[...round([600,700],2),...round([800,700],3)]).points,{a:1,b:1});
 assert.deepEqual(C.competition(people(4),round([600,700,800,900],2)).points,{a:3,b:2,c:1,d:0});
 assert.equal(C.competition(people(1),round([600],2)).rounds,0);assert.deepEqual(C.competition([],[]).points,{});
});
test('absent roster members do not block a two-person day or increase its points scale',()=>{
 const result=C.competition(people(3),[...round([600,700],2),...round([800,700],3)]);
 assert.equal(result.participants,2);assert.deepEqual(result.participantCounts,[2]);assert.equal(result.rounds,2);assert.equal(result.skippedRounds,0);
 assert.deepEqual(result.points,{a:1,b:1,c:0});assert.deepEqual(result.roundsByPerson,{a:2,b:2,c:0});
 const dnf=C.competition(people(3),round([600,null],2));assert.equal(dnf.participants,2);assert.deepEqual(dnf.points,{a:1,b:0,c:0});assert.deepEqual(dnf.roundsByPerson,{a:1,b:1,c:0},'DNF is attendance, not absence');
});
test('multi-day ranges sum each day using its actual attendance, never the union of attendees',()=>{
 const result=C.competition(people(3),[...round([600,700],2),...round([800,700,600],3,'2026-09-30'),record('c',500,4,'2026-09-28')]);
 assert.deepEqual(result.participantCounts,[2,3]);assert.equal(result.participants,3);assert.equal(result.rounds,2);assert.equal(result.skippedRounds,1);
 assert.deepEqual(result.points,{a:1,b:1,c:2});assert.deepEqual(result.roundsByPerson,{a:2,b:2,c:1});
 const alternating=C.competition(people(3),[...round([600,700],2),record('b',600,3,'2026-09-30'),record('c',700,3,'2026-09-30')]);
 assert.deepEqual(alternating.participantCounts,[2]);assert.deepEqual(alternating.points,{a:1,b:1,c:0});assert.deepEqual(alternating.roundsByPerson,{a:1,b:2,c:1});
});
test('a participant missing one round still invalidates that round even when another person is absent all day',()=>{
 const result=C.competition(people(4),[...round([600,700,800],2),...round([600,700],3)]);
 assert.equal(result.participants,3);assert.equal(result.rounds,1);assert.equal(result.skippedRounds,1);assert.deepEqual(result.points,{a:2,b:1,c:0,d:0});assert.equal(result.roundsByPerson.d,0);
});
test('ties share rank and points with later ranks skipped; source precision determines ties',()=>{
 assert.deepEqual(C.competition(people(3),round([600,600,700],2)).points,{a:2,b:2,c:0});
 assert.deepEqual(C.competition(people(3),round([600,700,700],2)).points,{a:2,b:1,c:1});
 assert.deepEqual(C.competition(people(2),round([600,600],2)).points,{a:1,b:1});
 assert.deepEqual(C.competition(people(3),round([699.1,699.2,699.3],2)).points,{a:2,b:1,c:0},'equal rounded 6.99 displays are not tied raw values');
});
test('DNF occupies a participant slot but always scores zero, even in an all-DNF round',()=>{
 const result=C.competition(people(3),[...round([600,700,null],2),...round([600,null,null],3),...round([null,null,null],4)]);
 assert.equal(result.rounds,3);assert.equal(result.skippedRounds,0);assert.deepEqual(result.points,{a:4,b:1,c:0});
});
test('round matching uses source rows AND dates, never nth records or date alone',()=>{
 const records=[record('a',600,2),record('b',700,3),record('a',600,4,'2026-09-29'),record('b',700,4,'2026-09-30'),record('a',600,undefined),record('b',700,undefined)];
 const result=C.competition(people(2),records);assert.equal(result.rounds,0);assert.equal(result.skippedRounds,4);assert.equal(result.unmatchedRecords,2);assert.deepEqual(result.points,{a:0,b:0});
 assert.equal(C.competition(people(2),round([600,700],2,null)).rounds,1,'undated same-row records can match in the all-records range');
});
test('duplicate entries and invalid scores invalidate a round instead of awarding phantom points',()=>{
 const duplicate=[...round([600,700],2),record('a',500,2)];assert.equal(C.competition(people(2),duplicate).skippedRounds,1);
 for(const score of [NaN,Infinity,undefined,0,-1]){const result=C.competition(people(2),round([600,score],2));assert.equal(result.rounds,0);assert.equal(result.skippedRounds,1);}
 const result=C.competition(people(2),[...round([600,700],2),record('z',400,2)]);assert.equal(result.rounds,1);assert.deepEqual(result.points,{a:1,b:0},'non-participant records do not affect rankings');
});
function boot(){
 const elements=new Map();const element=id=>({id,value:id==='range'?'0':'',textContent:'',innerHTML:'',attrs:{},listeners:{},classList:{toggle(){}},setAttribute(k,v){this.attrs[k]=String(v)},removeAttribute(k){delete this.attrs[k]},addEventListener(k,f){(this.listeners[k]||=[]).push(f)},dispatch(k,extra={}){for(const f of this.listeners[k]||[])f({target:this,...extra})},focus(){},querySelector(){return null},scrollTo(){}});
 for(const m of fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/\bid="([^"]+)"/g))elements.set(m[1],element(m[1]));
 const get=id=>{assert.ok(elements.has(id),'production DOM missing #'+id);return elements.get(id)};
 const document=element('document');document.querySelector=s=>get(s.slice(1));document.visibilityState='visible';
 let data={version:1,people:people(3),records:[...round([600,700,800],2),...round([700,600,null],3),...round([800,700,600],4,'2026-09-30'),record('a',500,5,'2026-09-30'),...round([600,650,700],6,null)],warnings:[],source:{title:'Test only'}};
 class Clock extends Date{static now(){return Date.parse('2026-09-30T04:00:00Z')}}
 const sandbox={document,CubeStats:C,Date:Clock,console,setInterval(){},setTimeout,fetch:async()=>({ok:true,status:200,json:async()=>({data,source:data.source,lastSuccessAt:new Date().toISOString(),refreshing:false,stale:false,error:null})})};sandbox.window=sandbox;
 vm.runInNewContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),sandbox);
 return {get,flush:async()=>{for(let i=0;i<12;i++)await Promise.resolve()},update(fields){data={...data,...fields}},select(person){document.dispatch('click',{target:{closest:s=>s==='[data-person]'?{dataset:{person}}:null}})}};
}
function displayedPoints(ui){return Object.fromEntries([...ui.get('comparison-body').innerHTML.matchAll(/data-competition-person="([^"]+)">([^<]+)<\/td>/g)].map(m=>[m[1],m[2]]));}
test('comparison cumulative points share date filtering, include undated records only in all, and survive refresh',async()=>{
 const ui=boot();await ui.flush();ui.get('comparison-tab').dispatch('click');
 assert.deepEqual(displayedPoints(ui),{a:'5',b:'5',c:'2'});assert.match(ui.get('competition-summary').textContent,/3 人比赛 · 计分 4 局 · 不足人数、不完整或异常跳过 1 局/);
 ui.get('range').value='day';ui.get('range').dispatch('change');assert.deepEqual(displayedPoints(ui),{a:'0',b:'1',c:'2'});assert.match(ui.get('competition-summary').textContent,/计分 1 局/);
 ui.get('range-date').value='2026-09-29';ui.get('range-date').dispatch('change');assert.deepEqual(displayedPoints(ui),{a:'3',b:'3',c:'0'});
 ui.get('refresh-data').dispatch('click');await ui.flush();assert.deepEqual(displayedPoints(ui),{a:'3',b:'3',c:'0'});assert.equal(ui.get('range-date').value,'2026-09-29');
 ui.select('b');ui.get('comparison-tab').dispatch('click');assert.deepEqual(displayedPoints(ui),{a:'3',b:'3',c:'0'},'selecting a person does not remove the other competitors');
 ui.get('range-date').value='2026-09-28';ui.get('range-date').dispatch('change');assert.deepEqual(displayedPoints(ui),{a:'—',b:'—',c:'—'});assert.match(ui.get('competition-summary').textContent,/暂无可计分的完整局/);
 ui.get('range').value='7';ui.get('range').dispatch('change');assert.deepEqual(displayedPoints(ui),{a:'3',b:'4',c:'2'},'recent calendar range excludes undated matches');
});
test('participant-count changes recompute the score scale; missing competitors and no complete rounds show a dash',async()=>{
 const ui=boot();await ui.flush();ui.update({people:people(2),records:[...round([600,700],2),...round([700,600],3)]});ui.get('refresh-data').dispatch('click');await ui.flush();assert.deepEqual(displayedPoints(ui),{a:'1',b:'1'});assert.match(ui.get('competition-summary').textContent,/2 人比赛 · 计分 2 局/);
 ui.update({people:people(3)});ui.get('refresh-data').dispatch('click');await ui.flush();assert.deepEqual(displayedPoints(ui),{a:'1',b:'1',c:'—'});assert.match(ui.get('competition-summary').textContent,/2 人比赛 · 计分 2 局/);
 ui.update({people:people(1),records:[record('a',600,2)]});ui.get('refresh-data').dispatch('click');await ui.flush();assert.deepEqual(displayedPoints(ui),{a:'—'});assert.match(ui.get('competition-summary').textContent,/至少 2 人/);
 ui.update({people:[],records:[]});ui.get('refresh-data').dispatch('click');await ui.flush();assert.match(ui.get('comparison-body').innerHTML,/colspan="7"/);
});
test('selected two-person date counts all 11 rounds, leaves absentee dashed, and distinguishes DNF zero from absence',async()=>{
 const ui=boot();await ui.flush();const records=Array.from({length:11},(_,i)=>round([i===0?null:(i%2?600:800),700],i+2,'2026-09-22')).flat();
 ui.update({records});ui.get('refresh-data').dispatch('click');await ui.flush();ui.get('range').value='day';ui.get('range').dispatch('change');
 assert.equal(ui.get('range-date').value,'2026-09-22');assert.deepEqual(displayedPoints(ui),{a:'5',b:'6',c:'—'});assert.match(ui.get('competition-summary').textContent,/2 人比赛 · 计分 11 局 · 不足人数、不完整或异常跳过 0 局/);
 ui.get('refresh-data').dispatch('click');await ui.flush();assert.deepEqual(displayedPoints(ui),{a:'5',b:'6',c:'—'});
 ui.update({records:round([600,null],2,'2026-09-22')});ui.get('refresh-data').dispatch('click');await ui.flush();assert.deepEqual(displayedPoints(ui),{a:'1',b:'0',c:'—'});
});
test('all-range comparison sums attendance per day and displays non-competitors as a dash even if they trained alone',async()=>{
 const ui=boot();await ui.flush();ui.update({records:[...round([600,700],2,'2026-09-22'),...round([800,700,600],3,'2026-09-23')]});ui.get('refresh-data').dispatch('click');await ui.flush();
 assert.deepEqual(displayedPoints(ui),{a:'1',b:'1',c:'2'});assert.match(ui.get('competition-summary').textContent,/按日 2–3 人比赛 · 计分 2 局/);
 ui.get('range').value='day';ui.get('range').dispatch('change');ui.get('range-date').value='2026-09-22';ui.get('range-date').dispatch('change');assert.deepEqual(displayedPoints(ui),{a:'1',b:'0',c:'—'});
 ui.get('range-date').value='2026-09-23';ui.get('range-date').dispatch('change');assert.deepEqual(displayedPoints(ui),{a:'0',b:'1',c:'2'});assert.match(ui.get('competition-summary').textContent,/3 人比赛 · 计分 1 局/);
 ui.update({records:[...round([600,700],2,'2026-09-22'),record('c',500,3,'2026-09-23')]});ui.get('range').value='0';ui.get('range').dispatch('change');ui.get('refresh-data').dispatch('click');await ui.flush();assert.deepEqual(displayedPoints(ui),{a:'1',b:'0',c:'—'},'solo training is not a zero-point competition');
});
const funRates=ui=>[3,2,1].map(n=>ui.get(`fun-sub7-${n}`).textContent);
test('fun statistics use a shared three-person denominator across filters, person switches and refresh',async()=>{
 const ui=boot();await ui.flush();
 const records=[...round([600,650,699.99],2),...round([600,650,700],3),...round([600,700,null],4),...round([null,null,null],5),...round([600,600,600],2,'2026-09-30'),...round([600,600,600],2,null),...round([600,600,600],2,'2026-01-01'),...round([600,600],2,'2026-09-28')];
 ui.update({records});ui.get('refresh-data').dispatch('click');await ui.flush();assert.deepEqual(funRates(ui),['57.1%','71.4%','85.7%']);assert.equal(ui.get('fun-sub7-3-count').textContent,'4 / 7 局');assert.match(ui.get('fun-summary').textContent,/7 局三人完整记录/);
 for(const range of ['7','30','90']){ui.get('range').value=range;ui.get('range').dispatch('change');assert.deepEqual(funRates(ui),['40.0%','60.0%','80.0%']);}
 ui.get('range').value='day';ui.get('range').dispatch('change');ui.get('range-date').value='2026-09-29';ui.get('range-date').dispatch('change');assert.deepEqual(funRates(ui),['25.0%','50.0%','75.0%']);
 const before=ui.get('metric-mean').textContent;ui.get('comparison-tab').dispatch('click');assert.equal(ui.get('metric-mean').textContent,before);
 ui.select('b');assert.deepEqual(funRates(ui),['25.0%','50.0%','75.0%']);ui.get('refresh-data').dispatch('click');await ui.flush();assert.deepEqual(funRates(ui),['25.0%','50.0%','75.0%']);assert.equal(ui.get('range-date').value,'2026-09-29');
 ui.get('range-date').value='2026-09-28';ui.get('range-date').dispatch('change');assert.deepEqual(funRates(ui),['—','—','—']);assert.match(ui.get('fun-summary').textContent,/暂无三人都有成绩/);assert.match(ui.get('competition-summary').textContent,/2 人比赛 · 计分 1 局/);
 ui.get('range-date').value='2026-09-27';ui.get('range-date').dispatch('change');assert.deepEqual(funRates(ui),['—','—','—']);assert.equal(ui.get('fun-sub7-1-count').textContent,'暂无样本');
});
test('fun statistics recompute after source changes, distinguish real zeroes, and explain non-three-person rosters',async()=>{
 const ui=boot();await ui.flush();ui.update({records:round([null,null,null],2)});ui.get('refresh-data').dispatch('click');await ui.flush();assert.deepEqual(funRates(ui),['0.0%','0.0%','0.0%']);assert.equal(ui.get('fun-sub7-1-count').textContent,'0 / 1 局');
 ui.update({records:round([600,600,600],2)});ui.get('refresh-data').dispatch('click');await ui.flush();assert.deepEqual(funRates(ui),['100.0%','100.0%','100.0%']);
 for(const n of [2,4,0]){ui.update({people:people(n),records:round([600,600,600],2).filter(r=>people(n).some(p=>p.id===r.personId))});ui.get('refresh-data').dispatch('click');await ui.flush();assert.deepEqual(funRates(ui),['—','—','—']);assert.match(ui.get('fun-summary').textContent,/需要源表恰好有三名人员/);}
});
function displayedOrder(ui){return [...ui.get('comparison-body').innerHTML.matchAll(/data-competition-person="([^"]+)"/g)].map(m=>m[1]);}
test('comparison sorts higher match points before faster mean and recomputes ordering for refresh and date filters',async()=>{
 const ui=boot();await ui.flush();const records=[...round([600,500],2),...round([600,500],3),...round([600,1000],4)];ui.update({records});ui.get('refresh-data').dispatch('click');await ui.flush();
 assert.deepEqual(displayedPoints(ui),{a:'1',b:'2',c:'—'});assert.deepEqual(displayedOrder(ui),['b','a','c'],'B has more points despite its slower average');
 ui.get('refresh-data').dispatch('click');await ui.flush();assert.deepEqual(displayedOrder(ui),['b','a','c']);
 ui.update({records:[...records,...round([500,700],5,'2026-09-30')]});ui.get('refresh-data').dispatch('click');await ui.flush();assert.deepEqual(displayedPoints(ui),{a:'2',b:'2',c:'—'});assert.deepEqual(displayedOrder(ui),['a','b','c'],'equal points use faster mean');
 ui.get('range').value='day';ui.get('range').dispatch('change');assert.deepEqual(displayedOrder(ui),['a','b','c']);ui.get('range-date').value='2026-09-29';ui.get('range-date').dispatch('change');assert.deepEqual(displayedOrder(ui),['b','a','c']);
});
test('zero-point competitors precede dashed solo trainers, and exact point/mean ties use name order',async()=>{
 const ui=boot();await ui.flush();ui.update({records:[...round([null,700],2),record('c',300,3,'2026-09-30')]});ui.get('refresh-data').dispatch('click');await ui.flush();assert.deepEqual(displayedPoints(ui),{a:'0',b:'1',c:'—'});assert.deepEqual(displayedOrder(ui),['b','a','c'],'0 points are real competition scores, not absence');
 ui.update({people:[{id:'a',name:'Zulu'},{id:'b',name:'Alpha'},{id:'c',name:'Charlie'}],records:round([600,600],2)});ui.get('refresh-data').dispatch('click');await ui.flush();assert.deepEqual(displayedOrder(ui),['b','a','c']);
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');assert.doesNotMatch(html,/按有效 ao5 均值排序|比分不改变原有均值排序/);
});
test('the competition column preserves unchanged personal statistics and uses mean only to break point ties',async()=>{
 const ui=boot();await ui.flush();const before={best:ui.get('metric-best').textContent,mean:ui.get('metric-mean').textContent,sub7:ui.get('metric-sub7').textContent};
 ui.get('comparison-tab').dispatch('click');const html=ui.get('comparison-body').innerHTML;assert.ok(html.indexOf('data-person="a"')<html.indexOf('data-person="b"'));assert.ok(html.indexOf('data-person="b"')<html.indexOf('data-person="c"'));
 const headings=[...fs.readFileSync(path.join(root,'index.html'),'utf8').slice(fs.readFileSync(path.join(root,'index.html'),'utf8').indexOf('<section id="comparison-panel"')).matchAll(/<th>(.*?)<\/th>/g)].map(m=>m[1]);assert.deepEqual(headings,['人员','累计比分','总组数 / DNF','最佳 ao5','平均 ao5','Sub7 率','标准差']);
 ui.get('personal-tab').dispatch('click');assert.deepEqual({best:ui.get('metric-best').textContent,mean:ui.get('metric-mean').textContent,sub7:ui.get('metric-sub7').textContent},before);
});
