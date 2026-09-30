'use strict';
const C=require('./core.js');
function parseRemoteScore(value){
  if(typeof value==='number'){
    if(!Number.isFinite(value)||value<=0||value>86400)throw new Error('用时不在有效范围内。');
    return value*100;
  }
  const text=String(value).trim();if(/^dnf$/i.test(text))return null;
  if(!/^(?:\d+:)?\d+(?:\.\d+)?$/.test(text))throw new Error('不是有效用时。');
  const parts=text.split(':');const seconds=Number(parts.pop());
  if(parts.length&&seconds>=60)throw new Error('分秒格式不正确。');
  const score=((parts.length?Number(parts[0])*60:0)+seconds)*100;
  if(!Number.isFinite(score)||score<=0||score>8640000)throw new Error('用时不在有效范围内。');return score;
}
function columnName(column){let name='';while(column>0){column--;name=String.fromCharCode(65+column%26)+name;column=Math.floor(column/26);}return name;}
function readDate(cell){
  if(!cell)return null;
  const text=typeof cell.value==='string'?cell.value.trim():String(cell.formatted??'').trim();
  const match=/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/.exec(text);
  if(match){const y=Number(match[1]),m=Number(match[2]),d=Number(match[3]);const date=new Date(Date.UTC(y,m-1,d));if(date.getUTCFullYear()!==y||date.getUTCMonth()!==m-1||date.getUTCDate()!==d)return null;return date.toISOString().slice(0,10);}
  if(typeof cell.value==='number'&&Number.isFinite(cell.value)&&cell.value>=1&&cell.value<100000){return new Date(Date.UTC(1899,11,30)+Math.floor(cell.value)*86400000).toISOString().slice(0,10);}
  return null;
}
function convertSnapshot(snapshot,source){
  if(!snapshot||snapshot.allLoaded!==true||!Array.isArray(snapshot.cells))throw new Error('腾讯工作表尚未完整加载，拒绝使用部分数据。');
  if(snapshot.sheetId!==source.sheetId)throw new Error('读取到的工作表与指定工作表不一致。');
  const indexed=new Map();
  for(const cell of snapshot.cells){
    if(!Number.isInteger(cell.row)||cell.row<1||!Number.isInteger(cell.col)||cell.col<1)throw new Error('腾讯表单元格坐标无效。');
    const key=`${cell.row}:${cell.col}`;if(indexed.has(key))throw new Error('腾讯表返回了重复单元格。');indexed.set(key,cell);
  }
  const header=snapshot.cells.filter(c=>c.row===1&&c.col>1&&String(c.value??'').trim()).sort((a,b)=>a.col-b.col);
  if(!header.length)throw new Error('未读到人员表头：第一行从 B 列起应为人员姓名。');
  const names=new Set();
  const people=header.map(cell=>{const name=String(cell.value).trim();if(names.has(name))throw new Error('人员表头有重名，请在腾讯文档中使用不同的名字。');if(name.length>40)throw new Error('人员表头过长。');names.add(name);return {id:`${snapshot.sheetId}_c${cell.col}`,name,target:null,sourceColumn:columnName(cell.col)};});
  const warnings=[],records=[];
  const maxRow=snapshot.cells.reduce((max,c)=>Math.max(max,c.row),1);
  let currentDate=null;
  for(let row=2;row<=maxRow;row++){
    const dateCell=indexed.get(`${row}:1`);
    if(dateCell&&String(dateCell.value??'').trim()){
      currentDate=readDate(dateCell);
      if(!currentDate)warnings.push({cell:`A${row}`,message:'日期无法识别；本行及后续空日期行暂不归入日期筛选，直到出现有效日期。'});
    }
    for(let i=0;i<header.length;i++){
      const col=header[i].col,cell=indexed.get(`${row}:${col}`);
      if(!cell||cell.value===null||cell.value===undefined||String(cell.value).trim()==='')continue;
      const sourceCell=`${columnName(col)}${row}`;
      if(cell.formula){warnings.push({cell:sourceCell,message:'公式单元格不是手动录入的 ao5，已跳过。'});continue;}
      let score;
      try{score=parseRemoteScore(cell.value);}catch(error){warnings.push({cell:sourceCell,kind:'invalid-score',message:'不是有效的 ao5 或 DNF，已跳过。'});continue;}
      if(score!==null&&score>=60000)warnings.push({cell:sourceCell,kind:'large-score',message:`原值 ${cell.value} 超过或等于 10 分钟，仍计入统计；若表示失败，请在腾讯文档中明确填写 DNF。`});
      records.push({id:`${snapshot.sheetId}_r${row}_c${col}`,personId:people[i].id,score,at:currentDate?new Date(currentDate+'T00:00:00+08:00').toISOString():null,date:currentDate,note:'',sourceRow:row,sourceColumn:columnName(col),sourceCell,sourceValue:cell.value,sourceText:String(cell.formatted??cell.value).trim()});
    }
  }
  return {version:1,people,records,warnings,source:{...source,title:snapshot.title,sheetName:snapshot.sheetName,sheetId:snapshot.sheetId}};
}
module.exports={convertSnapshot,columnName,readDate,parseRemoteScore};
