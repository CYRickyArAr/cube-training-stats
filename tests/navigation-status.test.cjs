'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'..');
test('sync status, timestamp and auto-sync are in navigation, never a duplicate main-content card',()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const header=/<header\b[^>]*>([\s\S]*?)<\/header>/.exec(html)[1],main=/<main\b[^>]*>([\s\S]*?)<\/main>/.exec(html)[1];
 for(const id of ['sync-status','last-success','auto-sync']){assert.ok(header.includes(`id="${id}"`));assert.ok(!main.includes(`id="${id}"`));assert.equal(html.split(`id="${id}"`).length,2);}
 assert.match(header,/<section class="sync-card"/);assert.doesNotMatch(header,/class="sync-card card"/);
 assert.match(header,/id="sync-status"[^>]*aria-live="polite"/);assert.match(header,/id="auto-sync"[^>]*type="checkbox"/);
});
test('navigation sync strip has no card spacing and adapts to tablet and phone widths',()=>{
 const css=fs.readFileSync(path.join(root,'styles.css'),'utf8');
 assert.match(css,/\.topbar>\.sync-card\{[^}]*margin:0;padding:0/);
 assert.match(css,/@media\(max-width:1200px\)\{[^\n]*\.topbar>\.sync-card\{[^}]*grid-row:2/);
 assert.match(css,/@media\(max-width:650px\)\{[^\n]*\.topbar>\.sync-card\{[^}]*grid-row:3/);
});
test('browser DOM geometry: navigation controls fit and remain outside the scrollable statistics area',
 {skip:process.env.CUBE_UI_TEST!=='1',timeout:45000},async()=>{
  const {TencentReader}=require('../tencent-reader.cjs');const browser=new TencentReader();
  try{
   await browser.start();
   const css=fs.readFileSync(path.join(root,'styles.css'),'utf8');
   const html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/<script\b[^>]*>[\s\S]*?<\/script>/g,'').replace(/<link rel="stylesheet"[^>]*>/,()=>'<style>'+css+'</style>');
   const frame=(await browser.cdp('Page.getFrameTree')).frameTree.frame.id;
   await browser.cdp('Page.setDocumentContent',{frameId:frame,html});
   await browser.evaluate(`document.querySelector('#last-success').textContent='成绩更新时间：2026/10/01 11:09:02';document.querySelector('#source-link').removeAttribute('aria-disabled');`);
   for(const [width,height] of [[1440,900],[1366,768],[1280,720],[1024,768],[768,1024],[390,844],[320,700]]){
    await browser.cdp('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<650});
    for(const status of ['统计快照已加载','正在读取腾讯文档…','读取失败 · 正在显示旧数据']){
     await browser.evaluate(`document.querySelector('#sync-status').textContent=${JSON.stringify(status)}`);
     const result=await browser.evaluate(`(()=>{const rect=s=>{const r=document.querySelector(s).getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom}};return {header:rect('.topbar'),main:rect('main'),workspace:rect('.workspace'),controls:['#sync-status','#last-success','.auto-sync-label','#source-link','#refresh-data','#export-csv'].map(rect),overflow:document.documentElement.scrollWidth>innerWidth,insideHeader:document.querySelector('.topbar').contains(document.querySelector('#sync-status'))}})()`);
     assert.equal(result.overflow,false,`${width}px no page overflow`);assert.equal(result.insideHeader,true);
     assert.ok(result.workspace.top>=result.header.bottom-1);assert.ok(result.main.top>=result.header.bottom-1);
     for(const r of result.controls){assert.ok(r.left>=0&&r.right<=width+1,`${width}px control fits horizontally: ${JSON.stringify(r)}`);assert.ok(r.top>=result.header.top&&r.bottom<=result.header.bottom+1,'control stays inside navigation');}
    }
   }
  }finally{await browser.close();}
 });
