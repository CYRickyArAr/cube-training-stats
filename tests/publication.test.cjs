'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const {publicPayload,assertSafe,documentUrl,publicPage,assertPublicPage,versionAssets}=require('../publish.cjs');
const secret={url:'https://docs.qq.com/sheet/PRIVATE_DOCUMENT_123?tab=PRIVATE_TAB&rtkey=PRIVATE_KEY_123',sheetId:'PRIVATE_TAB'};
const raw={version:1,people:[{id:'PRIVATE_TAB_c2',name:'cy',sourceColumn:'B'}],records:[{id:'PRIVATE_TAB_r2_c2',personId:'PRIVATE_TAB_c2',score:699.9,date:'2026-09-30',at:'2026-09-29T16:00:00Z',sourceRow:2,sourceColumn:'B',sourceCell:'B2',sourceValue:6.999,sourceText:'6.999',note:''},{id:'PRIVATE_TAB_r3_c2',personId:'PRIVATE_TAB_c2',score:null,date:'2026-09-30',sourceRow:3,sourceColumn:'B',sourceCell:'B3',sourceValue:'DNF',sourceText:'DNF'}],warnings:[],source:secret};
test('publication whitelists fields, removes private source and IDs, retains precision and DNF',()=>{const p=publicPayload(raw,secret,'2026-09-30T12:00:00Z');assertSafe(JSON.stringify(p),secret);assert.equal(p.data.records.length,2);assert.equal(p.data.records[0].score,699.9);assert.equal(p.data.records[0].sourceText,'6.999');assert.equal(p.data.records[1].score,null);assert.equal(p.data.records[0].personId,p.data.people[0].id);assert.equal(p.data.source.url,undefined);assert.equal(p.lastSuccessAt,'2026-09-30T12:00:00Z');assert.equal(p.data.records[0].id,'r1');});
test('secrets anywhere in public output fail closed',()=>{for(const text of [secret.url,'PRIVATE_DOCUMENT_123','PRIVATE_TAB','PRIVATE_KEY_123','https://docs.qq.com/sheet/other','rtkey=another'])assert.throws(()=>assertSafe(text,secret));const poisoned=structuredClone(raw);poisoned.people[0].name=secret.url;assert.throws(()=>publicPayload(poisoned,secret));});
test('no records or invalid person references are never published',()=>{assert.throws(()=>publicPayload({...raw,records:[]},secret));assert.throws(()=>publicPayload({...raw,records:[{...raw.records[0],personId:'missing'}]},secret));});
test('static page still uses relative GET only; source button URL is supplied only during publication',()=>{const root=path.join(__dirname,'..');const app=fs.readFileSync(path.join(root,'app.js'),'utf8'),html=fs.readFileSync(path.join(root,'index.html'),'utf8');assert.doesNotMatch(app,/\/api\/|source\.url|method:manual|POST/);assert.match(app,/\.\/data\.json/);assert.match(html,/<a id="source-link"[^>]*aria-disabled="true">打开腾讯文档<\/a>/);assert.doesNotMatch(html,/docs\.qq\.com/);});
test('published button opens the approved document in a new tab without any credentials or tracking',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
 const source={...secret,url:secret.url+'&utm_campaign=PRIVATE_TRACK_123#PRIVATE_FRAGMENT'};
 assert.equal(documentUrl(source),'https://docs.qq.com/sheet/PRIVATE_DOCUMENT_123');
 const published=publicPage(html,source);assertPublicPage(published,source);
 assert.match(published,/<a id="source-link" class="button-link" target="_blank" rel="noopener noreferrer" href="https:\/\/docs\.qq\.com\/sheet\/PRIVATE_DOCUMENT_123">打开腾讯文档<\/a>/);
 assert.doesNotMatch(published,/rtkey|PRIVATE_KEY_123|PRIVATE_TAB|PRIVATE_TRACK_123|PRIVATE_FRAGMENT|aria-disabled="true">打开腾讯文档/);
 assert.equal([...published.matchAll(/https:\/\/docs\.qq\.com/g)].length,1,'exactly one intentional public link');
 assertSafe(JSON.stringify(publicPayload(raw,secret)),secret);
});
test('the public-link exception applies only to the approved button, never scores or arbitrary HTML',()=>{
 const template=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8'),published=publicPage(template,secret);
 for(const leak of ['PRIVATE_DOCUMENT_123','PRIVATE_TAB','PRIVATE_KEY_123',secret.url,documentUrl(secret),'rtkey=other'])assert.throws(()=>assertPublicPage(published+'<p>'+leak+'</p>',secret));
 assert.throws(()=>assertPublicPage(published.replace(documentUrl(secret),documentUrl(secret)+'?rtkey=PRIVATE_KEY_123'),secret));
 assert.throws(()=>assertPublicPage(published.replace(documentUrl(secret),'https://docs.qq.com/sheet/other'),secret));
 assert.throws(()=>publicPage(template.replace('id="source-link"','id="removed-link"'),secret));
 assert.throws(()=>publicPage(template+template,secret));
 const poisoned=structuredClone(raw);poisoned.people[0].name=documentUrl(secret);assert.throws(()=>publicPayload(poisoned,secret));
});
test('all page assets carry content versions so old cached calendar scripts cannot mix with a new page',()=>{
 const root=path.join(__dirname,'..'),template=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const assets=Object.fromEntries(['styles.css','core.js','app.js'].map(name=>[name,fs.readFileSync(path.join(root,name),'utf8')]));
 const html=versionAssets(publicPage(template,secret),assets);assertPublicPage(html,secret);
 const hashes={};for(const name of Object.keys(assets)){const reference=html.match(new RegExp(name.replace('.','\\.')+'\\?v=([a-f0-9]{12})'));assert.ok(reference,'every asset has an explicit version');hashes[name]=reference[1];}
 assert.equal(html,versionAssets(publicPage(template,secret),assets),'versions are stable for identical files');
 const changed=versionAssets(publicPage(template,secret),{...assets,'app.js':assets['app.js']+'\n// changed calendar behavior'});
 assert.ok(!changed.includes('app.js?v='+hashes['app.js']),'new JS content gets a new cache key');
 assert.ok(changed.includes('core.js?v='+hashes['core.js']));assert.ok(changed.includes('styles.css?v='+hashes['styles.css']));
 assert.throws(()=>versionAssets(template,{}));assert.throws(()=>versionAssets(template.replace('src="app.js"','src="missing.js"'),assets));
});
test('invalid source URLs cannot become a public button destination',()=>{
 for(const url of ['http://docs.qq.com/sheet/PRIVATE_DOCUMENT_123','https://evil.example/sheet/PRIVATE_DOCUMENT_123','https://docs.qq.com:8443/sheet/PRIVATE_DOCUMENT_123','https://user:pass@docs.qq.com/sheet/PRIVATE_DOCUMENT_123','https://docs.qq.com/other/PRIVATE_DOCUMENT_123','https://docs.qq.com/sheet/PRIVATE_DOCUMENT_123?tab=wrong'])assert.throws(()=>documentUrl({...secret,url}));
});
