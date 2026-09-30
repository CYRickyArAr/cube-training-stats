'use strict';
const fs=require('node:fs');const path=require('node:path');
const {TencentReader}=require('./tencent-reader.cjs');const {convertSnapshot}=require('./tencent-sheet.cjs');
function assertSafe(text,source){
  const url=new URL(source.url);const forbidden=[source.url,source.sheetId,url.pathname.split('/').pop(),...Array.from(url.searchParams.values()).filter(value=>value.length>=8)].filter(Boolean);
  if(/docs\.qq\.com|rtkey\s*[=:]/i.test(text)||forbidden.some(value=>text.includes(value)))throw new Error('Publication blocked: private source information detected.');
}
function publicPayload(data,source,at=new Date().toISOString()){
  if(!data?.people?.length||!data?.records?.length)throw new Error('Publication blocked: empty snapshot.');
  const ids=new Map(data.people.map((p,i)=>[p.id,'p'+(i+1)]));
  const people=data.people.map(p=>({id:ids.get(p.id),name:p.name,target:null}));
  const records=data.records.map((r,i)=>{
    if(!ids.has(r.personId))throw new Error('Publication blocked: invalid person reference.');
    return {id:'r'+(i+1),personId:ids.get(r.personId),score:r.score,at:r.at??null,date:r.date??null,note:'',sourceRow:r.sourceRow,sourceColumn:r.sourceColumn,sourceCell:r.sourceCell,sourceValue:r.score===null?'DNF':r.score/100,sourceText:r.sourceText};
  });
  const safeSource={title:'训练成绩',sheetName:'公开统计快照'};
  const warnings=(data.warnings||[]).map(w=>({cell:w.cell,message:w.message}));
  const payload={data:{version:1,people,records,warnings,source:safeSource},source:safeSource,lastSuccessAt:at,attemptedAt:at,refreshing:false,stale:false,error:null,syncIntervalMs:60000};
  assertSafe(JSON.stringify(payload),source);return payload;
}
async function main(){
  const source=JSON.parse(process.env.SOURCE_CONFIG||'null');
  if(!source?.url||!source?.sheetId)throw new Error('Missing SOURCE_CONFIG secret.');
  const reader=new TencentReader();
  try{
    const raw=await reader.read(source);const payload=publicPayload(convertSnapshot(raw,source),source);
    const out=path.resolve(process.env.PUBLIC_OUTPUT||path.join(__dirname,'dist'));fs.mkdirSync(out,{recursive:true});
    for(const name of ['index.html','styles.css','core.js','app.js']){const text=fs.readFileSync(path.join(__dirname,name),'utf8');assertSafe(text,source);fs.writeFileSync(path.join(out,name),text);}
    fs.writeFileSync(path.join(out,'data.json'),JSON.stringify(payload));fs.writeFileSync(path.join(out,'.nojekyll'),'');
    console.log(`Published safe snapshot: ${payload.data.people.length} people, ${payload.data.records.length} records, ${payload.lastSuccessAt}`);
  }finally{await reader.close();}
}
module.exports={publicPayload,assertSafe};
if(require.main===module)main().catch(()=>{console.error('Publication failed; no deployment will run. Check source permission, network, or Secrets configuration. Private source details are not logged.');process.exitCode=1;});
