'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const C=require('../core.js');const root=path.join(__dirname,'..');
test('top cards are best, mean, median, Sub7; comparison column order stays unchanged',()=>{const html=fs.readFileSync(path.join(root,'index.html'),'utf8');const metrics=html.match(/<div class="metrics">([\s\S]*?)<\/div>/)[1];assert.deepEqual([...metrics.matchAll(/<span>(.*?)<\/span>/g)].map(m=>m[1]),['最佳 ao5','平均 ao5','中位数 ao5','Sub7 率']);assert.doesNotMatch(metrics,/标准差|metric-std/);const comparison=html.slice(html.indexOf('<section id="comparison-panel"'));const headings=[...comparison.matchAll(/<th>(.*?)<\/th>/g)].map(m=>m[1]);assert.deepEqual(headings.slice(-2),['Sub7 率','标准差']);});
test('comparison data cells match Sub7 then standard deviation, including insufficient-sample placeholders',async()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8'),elements=new Map();
 for(const m of html.matchAll(/\bid="([^"]+)"/g))elements.set(m[1],{value:m[1]==='range'?'0':'',textContent:'',innerHTML:'',classList:{toggle(){}},setAttribute(){},removeAttribute(){},addEventListener(){},querySelector(){return null}});
 const record=(id,personId,score)=>({id,personId,score,date:'2026-09-30',at:'2026-09-29T16:00:00Z',sourceRow:Number(id.slice(1)),sourceCell:'B2',note:''});
 const data={version:1,people:[{id:'a',name:'A'},{id:'b',name:'B'}],records:[record('r1','a',600),record('r2','a',800),record('r3','a',null),record('r4','b',650)],warnings:[]};
 const document={querySelector:s=>{assert.ok(elements.has(s.slice(1)),s);return elements.get(s.slice(1))},addEventListener(){},visibilityState:'visible'};
 const sandbox={document,CubeStats:C,console,setInterval(){},setTimeout,fetch:async()=>({ok:true,status:200,json:async()=>({data,lastSuccessAt:new Date().toISOString(),source:{title:'Test only'},stale:false,error:null})})};sandbox.window=sandbox;vm.runInNewContext(fs.readFileSync(path.join(root,'app.js'),'utf8'),sandbox);for(let i=0;i<12;i++)await Promise.resolve();
 const rows=[...elements.get('comparison-body').innerHTML.matchAll(/<tr>(.*?)<\/tr>/gs)].map(m=>[...m[1].matchAll(/<td[^>]*>(.*?)<\/td>/gs)].map(cell=>cell[1]));
 assert.equal(rows.length,2);
 assert.equal(elements.get('metric-median').textContent,'7.00');
 const analysis=elements.get('analysis').innerHTML;
 assert.deepEqual([...analysis.matchAll(/<span>(.*?)<\/span>/g)].map(m=>m[1]),['日均变化 · 较上次训练','标准差','P90 ao5','最长连续 Sub7']);
 assert.match(analysis,/id="analysis-std">1.00/);assert.doesNotMatch(analysis,/波动系数|成绩分布|中位数|最慢/);
 for(const row of rows){const id=row[0].includes('data-person="a"')?'a':'b',stats=C.analyze(data.records.filter(r=>r.personId===id));assert.equal(row.length,7);assert.equal(row[5],stats.sub7Rate.toFixed(1)+'%');assert.equal(row[6],stats.valid>=2?C.formatScore(stats.std):'—');}
});
