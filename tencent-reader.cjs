'use strict';
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const {spawn}=require('node:child_process');const {SourceFailure}=require('./source-errors.cjs');
const {assertOwnedProfile,processRequest,removeProfile}=require('./browser-processes.cjs');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const RUNTIME_ROOT=process.env.CUBE_RUNTIME_DIR||path.join(os.homedir(),'AppData','Local','hermes','cache','scratch','cube-stats-runtime');
function findEdge(){
 const candidates=[process.env.CUBE_EDGE_PATH,path.join(process.env['PROGRAMFILES(X86)']||'C:/Program Files (x86)','Microsoft','Edge','Application','msedge.exe'),path.join(process.env.PROGRAMFILES||'C:/Program Files','Microsoft','Edge','Application','msedge.exe')].filter(Boolean);
 const found=candidates.find(file=>fs.existsSync(file));if(!found)throw new SourceFailure('BROWSER_MISSING');return found;
}
function assertSource(source){
 try{const url=new URL(source.url);if(url.protocol!=='https:'||url.hostname!=='docs.qq.com'||!/^\/sheet\/[A-Za-z0-9_-]+$/.test(url.pathname)||url.username||url.password||!/^\w+$/.test(source.sheetId)||url.searchParams.get('tab')&&url.searchParams.get('tab')!==source.sheetId)throw new Error();}
 catch{throw new SourceFailure('CONFIG_INVALID');}
}
function parseDevToolsActivePort(text){
 const [port,browserPath]=String(text).trim().split(/\r?\n/);
 return /^\d+$/.test(port)&&Number(port)>0&&Number(port)<=65535&&/^\/devtools\/browser\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(browserPath)?port:null;
}
function startupFailure(error,operation='spawn'){
 const osCode=error?.code||'UNKNOWN';
 const temporary=['EAGAIN','ENOMEM','EMFILE','ENFILE',...(operation==='active_port_read'?['EBUSY','ETXTBSY']:[])].includes(osCode);
 return new SourceFailure(['EACCES','EPERM'].includes(osCode)?'BROWSER_PERMISSION_DENIED':osCode==='ENOENT'?'BROWSER_MISSING':temporary?'BROWSER_RESOURCE_BUSY':'BROWSER_START_FAILED','browser_start',0,{operation,osCode});
}
function launcherFailure(exitCode,signal){
 const unsigned=Number.isInteger(exitCode)?exitCode>>>0:null;
 return new SourceFailure([0xc0000017,0xc000009a].includes(unsigned)?'BROWSER_RESOURCE_BUSY':'BROWSER_START_FAILED','browser_start',0,{operation:'launcher_exit',exitCode,signal});
}
function contextLost(text){return /Execution context was destroyed|Cannot find context with specified id|Inspected target navigated or closed|Target closed/i.test(String(text));}
class TencentReader{
 constructor({runtimeRoot=RUNTIME_ROOT,browserPath,signal,processControl=processRequest,profileRemoval=removeProfile,onDiagnostic=()=>{}}={}){this.processControl=processControl;this.profileRemoval=profileRemoval;this.onDiagnostic=onDiagnostic;this.runtimeRoot=runtimeRoot;this.browserPath=browserPath;this.signal=signal;this.phase='browser_start';this.browser=null;this.socket=null;this.pending=new Map();this.sequence=0;this.starting=null;this.profile=null;}
 checkAbort(){if(this.signal?.aborted)throw new SourceFailure('READ_ATTEMPT_TIMEOUT',this.phase);}
 async start(){if(this.socket?.readyState===1)return;if(this.starting)return this.starting;this.starting=this._start();try{await this.starting;}finally{this.starting=null;}}
 async _start(){
  this.phase='browser_start';this.checkAbort();await this.close();this.checkAbort();
  let edge,operation='runtime_directory';try{fs.mkdirSync(this.runtimeRoot,{recursive:true});this.profile=fs.mkdtempSync(path.join(this.runtimeRoot,'reader-'));edge=this.browserPath||findEdge();operation='spawn';this.browser=spawn(edge,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-extensions','--remote-debugging-port=0','--user-data-dir='+this.profile,'about:blank'],{stdio:'ignore',windowsHide:true});}
  catch(error){if(error instanceof SourceFailure)throw error;throw startupFailure(error,operation);}
  let startupError=null;this.browser.once('error',error=>{startupError=error;});let port=null;
  for(let i=0;i<200;i++){
   this.checkAbort();if(startupError)throw startupFailure(startupError);
   // Edge's launcher may exit successfully while a child owns the browser.
   if(this.browser.signalCode||this.browser.exitCode!==null&&this.browser.exitCode!==0)throw launcherFailure(this.browser.exitCode,this.browser.signalCode);
   const activeFile=path.join(this.profile,'DevToolsActivePort');
   try{port=parseDevToolsActivePort(fs.readFileSync(activeFile,'utf8'));}
   catch(error){if(error.code!=='ENOENT')throw startupFailure(error,'active_port_read');}
   if(port)break;await wait(100);
  }
  if(!port)throw new SourceFailure('BROWSER_START_TIMEOUT');this.phase='browser_connect';this.checkAbort();
  let response,tabs;try{response=await fetch('http://127.0.0.1:'+port+'/json/list',{signal:this.signal?AbortSignal.any([this.signal,AbortSignal.timeout(5000)]):AbortSignal.timeout(5000)});if(!response.ok)throw new SourceFailure(response.status>=500?'DEBUG_ENDPOINT_NETWORK':'DEBUG_ENDPOINT_INVALID');tabs=await response.json();}
  catch(error){this.checkAbort();if(error instanceof SourceFailure)throw error;if(['AbortError','TimeoutError'].includes(error.name))throw new SourceFailure('DEBUG_ENDPOINT_TIMEOUT');if(['ECONNREFUSED','ECONNRESET','ETIMEDOUT','UND_ERR_CONNECT_TIMEOUT'].includes(error.cause?.code))throw new SourceFailure('DEBUG_ENDPOINT_NETWORK');throw new SourceFailure('DEBUG_ENDPOINT_INVALID');}
  const tab=Array.isArray(tabs)&&tabs.find(item=>item.type==='page');if(!tab)throw new SourceFailure('DEBUG_ENDPOINT_INVALID');
  let socket;try{socket=new WebSocket(tab.webSocketDebuggerUrl);}catch{throw new SourceFailure('DEBUG_ENDPOINT_INVALID');}this.socket=socket;
  socket.onmessage=event=>{
   let message;try{message=JSON.parse(event.data);}catch{for(const task of this.pending.values()){clearTimeout(task.timer);task.reject(new SourceFailure('CDP_PROTOCOL_ERROR',task.phase));}this.pending.clear();return;}
   if(!message.id)return;const task=this.pending.get(message.id);if(!task)return;this.pending.delete(message.id);clearTimeout(task.timer);
   if(message.error)task.reject(new SourceFailure(contextLost(message.error.message)?'CDP_CONTEXT_LOST':'CDP_PROTOCOL_ERROR',task.phase));else task.resolve(message.result);
  };
  socket.onclose=()=>{for(const task of this.pending.values()){clearTimeout(task.timer);task.reject(new SourceFailure('DEBUG_SOCKET_DISCONNECTED',task.phase));}this.pending.clear();};
  let abort;
  try{await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new SourceFailure('DEBUG_SOCKET_TIMEOUT')),5000);const finish=fn=>{clearTimeout(timer);fn();};socket.onopen=()=>finish(resolve);socket.onerror=()=>finish(()=>reject(new SourceFailure('DEBUG_ENDPOINT_NETWORK')));abort=()=>finish(()=>reject(new SourceFailure('READ_ATTEMPT_TIMEOUT',this.phase)));this.signal?.addEventListener('abort',abort,{once:true});if(this.signal?.aborted)abort();});}
  finally{if(abort)this.signal?.removeEventListener('abort',abort);}
  this.checkAbort();await this.cdp('Runtime.enable');await this.cdp('Page.enable');
 }
 cdp(method,params={}){
  const closing=method==='Browser.close';if(!closing)this.checkAbort();
  if(this.socket?.readyState!==1)return Promise.reject(new SourceFailure('DEBUG_SOCKET_DISCONNECTED',this.phase));
  return new Promise((resolve,reject)=>{const id=++this.sequence,phase=closing?'cleanup':this.phase;const timer=setTimeout(()=>{this.pending.delete(id);reject(new SourceFailure('CDP_TIMEOUT',phase));},closing?1500:15000);this.pending.set(id,{resolve,reject,timer,phase});try{this.socket.send(JSON.stringify({id,method,params}));}catch{this.pending.delete(id);clearTimeout(timer);reject(new SourceFailure('DEBUG_SOCKET_DISCONNECTED',phase));}});
 }
 async evaluate(expression){
  const response=await this.cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
  if(response.exceptionDetails){const description=response.exceptionDetails.exception?.description||response.exceptionDetails.text;throw new SourceFailure(contextLost(description)?'CDP_CONTEXT_LOST':String(description).includes('工作表超过当前完整读取上限')?'SOURCE_LIMIT_EXCEEDED':'SOURCE_SCRIPT_ERROR',this.phase);}
  return response.result.value;
 }
 async read(source){
  assertSource(source);this.checkAbort();await this.start();this.phase='navigate';
  const navigation=await this.cdp('Page.navigate',{url:source.url});
  if(navigation.errorText)throw new SourceFailure(/ERR_NETWORK_CHANGED|ERR_CONNECTION_RESET|ERR_CONNECTION_REFUSED|ERR_CONNECTION_TIMED_OUT|ERR_TIMED_OUT|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED/.test(navigation.errorText)?'SOURCE_NAVIGATION_NETWORK':'SOURCE_NAVIGATION_DENIED');
  this.phase='source_read';
  // Read-only extraction; never call mutationApi or commitService.
  const expression=`JSON.stringify((()=>{
   const app=window.SpreadsheetApp;
   if(!window.SpreadsheetAppInitComplete||!app?.workbook)return {ready:false};
   const sheet=app.workbook.worksheetManager.getSheetBySheetId(${JSON.stringify(source.sheetId)});
   if(!sheet||!sheet.getIsInitialized?.()||!sheet.highWaterMark?.isAllChunkLoaded?.())return {ready:false};
   const range=sheet.cellDataGrid?.usedRange;
   if(!range||!Number.isInteger(range.endRowIndex)||!Number.isInteger(range.endColIndex)||typeof sheet.getCellDataAtPosition!=='function')return {ready:false};
   if(range.endRowIndex>9999||range.endColIndex>199||(range.endRowIndex+1)*(range.endColIndex+1)>1000000)throw new Error('工作表超过当前完整读取上限（最多一百万个单元格）。');
   const cells=[];
   for(let row=0;row<=range.endRowIndex;row++)for(let col=0;col<=range.endColIndex;col++){
    const cell=sheet.getCellDataAtPosition(row,col);
    if(cell&&cell.value!==undefined&&cell.value!==null&&cell.value!=='')cells.push({row:row+1,col:col+1,value:cell.value,formatted:cell.formattedValue?.value,formula:!!(cell.formula||cell.formulaModel)});
   }
   if(!cells.some(cell=>cell.row===1&&cell.col>1))return {ready:false};
   return {ready:true,title:document.title,sheetId:sheet.getSheetId(),sheetName:sheet.getSheetName(),allLoaded:true,range,cells};
  })())`;
  let previous=null;const end=Date.now()+65000;
  while(Date.now()<end){
   this.checkAbort();let result;try{result=JSON.parse(await this.evaluate(expression));}catch(error){if(error instanceof SourceFailure)throw error;throw new SourceFailure('SOURCE_SCRIPT_ERROR');}
   if(result.ready){const identity=JSON.stringify({range:result.range,cells:result.cells.map(c=>({row:c.row,col:c.col,value:c.value,formula:c.formula}))});if(identity===previous){delete result.ready;return result;}previous=identity;}else{previous=null;const body=await this.evaluate('(document.body?.innerText||"").slice(0,3000)');if(/没有权限|无权访问|文档不存在|文档已删除|访问受限|申请权限/.test(body))throw new SourceFailure('SOURCE_PERMISSION_DENIED');}
   await wait(700);
  }
  const body=await this.evaluate('(document.body?.innerText||"").slice(0,3000)');
  if(/没有权限|无权访问|文档不存在|文档已删除|访问受限|申请权限/.test(body))throw new SourceFailure('SOURCE_PERMISSION_DENIED');
  throw new SourceFailure('SOURCE_INCOMPLETE_TIMEOUT');
 }
 async close(){
  const previousPhase=this.phase;this.phase='cleanup';const browser=this.browser,socket=this.socket,profile=this.profile;
  try{
   let target,captured;
   if(profile){
    target=assertOwnedProfile(profile,this.runtimeRoot);
    captured=await this.processControl({mode:'capture',profile:target,launcherPid:browser?.exitCode===null?browser.pid:null});
    if(!Array.isArray(captured?.proofs))throw new SourceFailure('READER_PROCESS_UNCONFIRMED','cleanup',0,{operation:'process_inventory'});
   }
   if(socket){if(socket.readyState===1){try{await this.cdp('Browser.close');}catch{}}try{socket.close();}catch{}}
   this.socket=null;for(const task of this.pending.values()){clearTimeout(task.timer);task.reject(new SourceFailure('DEBUG_SOCKET_DISCONNECTED',task.phase));}this.pending.clear();
   if(target){
    const settled=await this.processControl({mode:'settle',profile:target,proofs:captured.proofs});
    if(settled?.remaining!==0)throw new SourceFailure('READER_PROCESS_UNCONFIRMED','cleanup',0,{operation:'process_termination'});
    this.onDiagnostic({event:'browser_cleanup_complete',stage:'cleanup',code:'BROWSER_STOPPED',terminated:Number.isInteger(settled.terminated)?settled.terminated:0});
    await this.profileRemoval(target,{onDiagnostic:this.onDiagnostic});this.profile=null;
   }
   this.browser=null;
  }catch(error){if(error instanceof SourceFailure)throw error;throw new SourceFailure('READER_CLEANUP_FAILED','cleanup');}finally{this.phase=previousPhase;}
 }

}
module.exports={TencentReader,assertSource,RUNTIME_ROOT,parseDevToolsActivePort,startupFailure,launcherFailure};
