'use strict';
// Synthetic data stays inside tests, never a production fallback.
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const C=require('../core.js');const root=path.join(__dirname,'..');
const make=(score,index)=>({id:'r'+index,personId:'p1',score,date:'2026-09-30',at:'2026-09-29T16:00:00Z',sourceRow:index+2,sourceCell:'B'+(index+2),note:''});
const values=[...Array(20).fill(3000),...Array(20).fill(1000),...Array(15).fill(800),...Array(5).fill(400)];
const mean=arr=>arr.reduce((a,b)=>a+b,0)/arr.length;
const expectedPrevious=mean(values.slice(-40,-20)),expectedRecent=mean(values.slice(-20));
const expectedPercent=(expectedPrevious-expectedRecent)/expectedPrevious*100;
function boot(records){
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),elements=new Map();
 const element=id=>({id,textContent:'',innerHTML:'',hidden:false,disabled:false,checked:true,value:id==='range'?'0':'',attrs:{},classList:{toggle(){}},setAttribute(k,v){this.attrs[k]=v},removeAttribute(k){delete this.attrs[k]},addEventListener(){},querySelector(){return null},scrollTo(){}});
 for(const m of html.matchAll(/\bid="([^"]+)"/g))elements.set(m[1],element(m[1]));
 const document={querySelector:s=>{assert.ok(elements.has(s.slice(1)),s);return elements.get(s.slice(1))},addEventListener(){},visibilityState:'visible'};
 const payload={data:{version:1,people:[{id:'p1',name:'test',target:null}],records,warnings:[],source:{title:'Test only'}},source:{title:'Test only'},lastSuccessAt:'2026-09-30T04:00:00Z',refreshing:false,stale:false,error:null};
 class Clock extends Date{static now(){return Date.parse('2026-09-30T04:00:00Z')}}
 const sandbox={document,console,CubeStats:C,Date:Clock,setInterval(){},setTimeout,fetch:async()=>({ok:true,status:200,json:async()=>payload})};sandbox.window=sandbox;
 vm.runInNewContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),sandbox);
 return {elements,flush:async()=>{for(let i=0;i<12;i++)await Promise.resolve()}};
}
test('recent trend compares last 20 valid ao5 with previous 20, ignores older records and DNF',()=>{
 const records=values.map(make);records.push(make(null,100));records.reverse();
 const stats=C.analyze(records);assert.equal(stats.recentMean,expectedRecent);assert.equal(stats.previousMean,expectedPrevious);assert.equal(stats.improvement,expectedPercent);
 for(const n of [0,19,20,39])assert.equal(C.analyze(Array.from({length:n},(_,i)=>make(800,i))).improvement,null,`${n} valid groups cannot form two windows`);
 assert.notEqual(C.analyze(Array.from({length:40},(_,i)=>make(i<20?1000:800,i))).improvement,null);
});
test('trend card shows two 20-group windows and asks for 40 valid groups when insufficient',async()=>{
 const ui=boot([...values.map(make),make(null,100)].reverse());await ui.flush();
 const text=ui.elements.get('analysis').innerHTML;
 assert.match(text,new RegExp('近期提升 '+expectedPercent.toFixed(1)+'%'));
 assert.match(text,new RegExp('此前 20 组 '+C.formatScore(expectedPrevious)+' → 最近 20 组 '+C.formatScore(expectedRecent)));
 assert.doesNotMatch(text,/此前 5 组|最近 5 组/);
 const short=boot(Array.from({length:39},(_,i)=>make(800,i)));await short.flush();assert.match(short.elements.get('analysis').innerHTML,/至少 40 组有效 ao5/);
 assert.match(fs.readFileSync(path.join(root,'index.html'),'utf8'),/最近 40 条有效记录/);
});
