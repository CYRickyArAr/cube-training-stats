'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const root=path.join(__dirname,'..');
test('trend hover is opt-in: no permanently rendered dots, nearest-x hit regions and safe tooltip text',()=>{
 const app=fs.readFileSync(path.join(root,'app.js'),'utf8'),css=fs.readFileSync(path.join(root,'styles.css'),'utf8');
 assert.doesNotMatch(app,/（仅用于画图，不计入统计）/);assert.match(app,/data-plot-x=/);assert.match(app,/createElementNS\('http:\/\/www.w3.org\/2000\/svg','circle'\)/);assert.match(app,/trend-tooltip.*role="tooltip"/);assert.match(app,/details\.map\(text => .*escape\(text\)/);assert.match(css,/\.trend-hover-point\{[^}]*pointer-events:none/);assert.match(css,/\.trend-tooltip\{[^}]*pointer-events:none/);
});
test('browser hover shows exactly one anchored dot and tooltip, handles gaps, touch, keyboard and layout changes',
 {skip:process.env.CUBE_UI_TEST!=='1',timeout:60000},async()=>{
 const {TencentReader}=require('../tencent-reader.cjs');const browser=new TencentReader();
 try{
  await browser.start();const css=fs.readFileSync(path.join(root,'styles.css'),'utf8');
  const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link rel="stylesheet"[^>]*>/,()=>'<style>'+css+'</style>');const frame=(await browser.cdp('Page.getFrameTree')).frameTree.frame.id;await browser.cdp('Page.setDocumentContent',{frameId:frame,html});
  const today=new Date(Date.now()+8*3600000).toISOString().slice(0,10),date=i=>new Date(Date.parse(today+'T00:00:00Z')-(4-i)*86400000).toISOString().slice(0,10);
  const record=(id,score,i,personId='a')=>({id,personId,score,date:date(i),at:date(i)+'T00:00:00+08:00',sourceRow:2+Number(id.replace(/\D/g,'')),sourceCell:'B2',note:''});
  const payload={data:{version:1,people:[{id:'a',name:'Test A'},{id:'b',name:'Test B'}],records:[record('r1',600,0),record('r2',800,0),record('r3',null,2),record('r4',650,4),record('r5',550,0,'b')],warnings:[]},lastSuccessAt:new Date().toISOString(),stale:false,error:null};
  await browser.evaluate(fs.readFileSync(path.join(root,'core.js'),'utf8'));await browser.evaluate(`window.fetch=async()=>({ok:true,status:200,json:async()=>(${JSON.stringify(payload)})})`);await browser.evaluate(fs.readFileSync(path.join(root,'app.js'),'utf8'));await browser.evaluate(`new Promise(r=>setTimeout(r,30))`);await browser.evaluate(`document.querySelector('#auto-sync').checked=false`);
  const state=()=>browser.evaluate(`(()=>{const c=document.querySelector('#chart'),t=c.querySelector('.trend-tooltip'),p=c.querySelector('.trend-hover-point');const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}};return {dots:c.querySelectorAll('circle').length,hidden:!t||t.hidden,text:t?.textContent||'',point:p?rect(p):null,tooltip:t&&!t.hidden?rect(t):null,chart:rect(c),dateLabels:c.querySelectorAll('.trend-date').length}})()`);
  const hover=async i=>{const p=await browser.evaluate(`(()=>{const r=document.querySelectorAll('#chart .trend-hit')[${i}].getBoundingClientRect();return {x:(r.left+r.right)/2,y:r.top+10}})()`);await browser.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:p.x,y:p.y});};
  const leave=()=>browser.cdp('Input.dispatchMouseEvent',{type:'mouseMoved',x:0,y:0});
  const key=k=>browser.evaluate(`document.querySelector('#chart svg').dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},bubbles:true}))`);
  assert.equal((await state()).dots,0);assert.equal((await state()).hidden,true);
  for(const [width,height] of [[1366,768],[768,1024],[390,844]]){
   await browser.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<650});await browser.evaluate(`document.querySelector('#chart').scrollIntoView({block:'center'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
   for(const i of [0,1,4]){await hover(i);const s=await state();assert.equal(s.dots,1,JSON.stringify({width,i,s}));assert.equal(s.hidden,false);assert.ok(s.text.includes(date(i)));if(i===1)assert.match(s.text,/无训练记录，沿用/);assert.equal(s.dateLabels,0);assert.ok(s.tooltip.left>=s.chart.left-1&&s.tooltip.right<=s.chart.right+1,'tooltip fits chart width');assert.ok(s.tooltip.top>=s.chart.top-1&&s.tooltip.bottom<=s.chart.bottom+1,'tooltip fits chart height');assert.ok(Math.abs(s.point.width-10)<.3,'hover dot stays 10 CSS pixels wide at every viewport');}
   await hover(2);assert.equal((await state()).dots,0);assert.match((await state()).text,/全 DNF/);await hover(3);assert.equal((await state()).dots,0);assert.match((await state()).text,/无可沿用/);
   await leave();assert.equal((await state()).hidden,true);assert.equal((await state()).dots,0);
  }
  await key('Home');assert.equal((await state()).dots,1);assert.ok((await state()).text.includes(date(0)));await key('ArrowRight');assert.match((await state()).text,/无训练记录，沿用/);await key('End');assert.ok((await state()).text.includes(date(4)));await key('Escape');assert.equal((await state()).hidden,true);
  await browser.evaluate(`document.querySelector('#chart .trend-hit').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch'}))`);assert.equal((await state()).dots,1);await browser.evaluate(`document.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,pointerType:'touch'}))`);assert.equal((await state()).dots,0);
  await key('Home');await browser.evaluate(`document.querySelector('#histogram-chart-tab').click()`);assert.equal((await state()).dots,0);assert.equal((await state()).hidden,true);await browser.evaluate(`document.querySelector('#trend-chart-tab').click()`);assert.equal((await state()).dots,0);
  await key('Home');await browser.evaluate(`document.querySelector('#range').value='day';document.querySelector('#range').dispatchEvent(new Event('change',{bubbles:true}))`);assert.equal((await state()).hidden,true);await browser.evaluate(`document.querySelector('#range').value='0';document.querySelector('#range').dispatchEvent(new Event('change',{bubbles:true}))`);
  await key('Home');await browser.evaluate(`document.querySelector('#people-list [data-person="b"]').click()`);assert.equal((await state()).hidden,true);
  await key('Home');await browser.evaluate(`document.querySelector('#refresh-data').click();new Promise(r=>setTimeout(r,30))`);assert.equal((await state()).hidden,true);
  await key('Home');await browser.evaluate(`window.dispatchEvent(new Event('resize'))`);assert.equal((await state()).hidden,true);
  await key('Home');await browser.evaluate(`document.querySelector('#stats-main').dispatchEvent(new Event('scroll'))`);assert.equal((await state()).hidden,true);
 }finally{await browser.close();}
});
