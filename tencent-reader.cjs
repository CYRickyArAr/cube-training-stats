'use strict';
const fs=require('node:fs');const path=require('node:path');const os=require('node:os');const {spawn}=require('node:child_process');
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const RUNTIME_ROOT=process.env.CUBE_RUNTIME_DIR||path.join(os.homedir(),'AppData','Local','hermes','cache','scratch','cube-stats-runtime');
function findEdge(){
  const candidates=[process.env.CUBE_EDGE_PATH,path.join(process.env['PROGRAMFILES(X86)']||'C:/Program Files (x86)','Microsoft','Edge','Application','msedge.exe'),path.join(process.env.PROGRAMFILES||'C:/Program Files','Microsoft','Edge','Application','msedge.exe')].filter(Boolean);
  const found=candidates.find(file=>fs.existsSync(file));if(!found)throw new Error('未找到 Microsoft Edge，请安装 Edge 后重新打开统计页面。');return found;
}
function assertSource(source){
  const url=new URL(source.url);
  if(url.protocol!=='https:'||url.hostname!=='docs.qq.com'||!/^\/sheet\/[A-Za-z0-9_-]+$/.test(url.pathname)||url.username||url.password||!/^\w+$/.test(source.sheetId))throw new Error('只允许读取指定的腾讯文档表格。');
  if(url.searchParams.get('tab')&&url.searchParams.get('tab')!==source.sheetId)throw new Error('网址中的工作表标识与配置不一致。');
}
class TencentReader{
  constructor({runtimeRoot=RUNTIME_ROOT,browserPath}={}){this.runtimeRoot=runtimeRoot;this.browserPath=browserPath;this.browser=null;this.socket=null;this.pending=new Map();this.sequence=0;this.starting=null;this.profile=null;}
  async start(){
    if(this.socket?.readyState===1)return;
    if(this.starting)return this.starting;
    this.starting=this._start();try{await this.starting;}finally{this.starting=null;}
  }
  async _start(){
    await this.close();
    fs.mkdirSync(this.runtimeRoot,{recursive:true});this.profile=fs.mkdtempSync(path.join(this.runtimeRoot,'reader-'));
    const edge=this.browserPath||findEdge();
    this.browser=spawn(edge,['--headless=new','--disable-gpu','--no-first-run','--no-default-browser-check','--disable-extensions','--remote-debugging-port=0','--user-data-dir='+this.profile,'about:blank'],{stdio:'ignore'});
    let startupError=null;this.browser.once('error',error=>{startupError=error;});
    let port=null;
    for(let i=0;i<200;i++){
      if(startupError)throw startupError;
      // Windows Edge 启动器可能先以 0 退出，实际浏览器由子进程接管；以调试端口就绪为准。
      if(this.browser.exitCode!==null&&this.browser.exitCode!==0)throw new Error('Edge 读取进程启动失败。');
      const activeFile=path.join(this.profile,'DevToolsActivePort');
      if(fs.existsSync(activeFile)){port=fs.readFileSync(activeFile,'utf8').trim().split(/\r?\n/)[0];break;}
      await wait(100);
    }
    if(!port||!/^\d+$/.test(port))throw new Error('Edge 启动超时，无法连接本地读取器。');
    const response=await fetch('http://127.0.0.1:'+port+'/json/list',{signal:AbortSignal.timeout(5000)});
    const tabs=await response.json();const tab=tabs.find(item=>item.type==='page');if(!tab)throw new Error('没有找到腾讯读取标签页。');
    const socket=new WebSocket(tab.webSocketDebuggerUrl);this.socket=socket;
    await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('读取器连接超时。')),5000);socket.onopen=()=>{clearTimeout(timer);resolve();};socket.onerror=()=>{clearTimeout(timer);reject(new Error('读取器连接失败。'));};});
    socket.onmessage=event=>{
      const message=JSON.parse(event.data);if(!message.id)return;
      const promise=this.pending.get(message.id);if(!promise)return;this.pending.delete(message.id);clearTimeout(promise.timer);
      if(message.error)promise.reject(new Error(message.error.message));else promise.resolve(message.result);
    };
    socket.onclose=()=>{for(const task of this.pending.values()){clearTimeout(task.timer);task.reject(new Error('腾讯读取浏览器连接已断开。'));}this.pending.clear();};
    await this.cdp('Runtime.enable');await this.cdp('Page.enable');
  }
  cdp(method,params={}){
    if(this.socket?.readyState!==1)return Promise.reject(new Error('读取浏览器未连接。'));
    return new Promise((resolve,reject)=>{const id=++this.sequence;const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('腾讯读取操作超时。'));},15000);this.pending.set(id,{resolve,reject,timer});this.socket.send(JSON.stringify({id,method,params}));});
  }
  async evaluate(expression){
    const response=await this.cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});
    if(response.exceptionDetails)throw new Error(response.exceptionDetails.exception?.description||response.exceptionDetails.text);
    return response.result.value;
  }
  async read(source){
    assertSource(source);await this.start();
    // 仅导航与读取；从不调用 mutationApi/commitService 或向文档写入。
    const navigation=await this.cdp('Page.navigate',{url:source.url});
    if(navigation.errorText)throw new Error('腾讯文档页面无法打开：'+navigation.errorText);
    const expression=`JSON.stringify((()=>{
      const app=window.SpreadsheetApp;
      if(!window.SpreadsheetAppInitComplete||!app?.workbook)return {ready:false};
      const sheet=app.workbook.worksheetManager.getSheetBySheetId(${JSON.stringify(source.sheetId)});
      if(!sheet||!sheet.getIsInitialized()||!sheet.highWaterMark.isAllChunkLoaded())return {ready:false};
      const range=sheet.cellDataGrid.usedRange;
      if(!range||!Number.isInteger(range.endRowIndex)||!Number.isInteger(range.endColIndex))return {ready:false};
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
      const text=await this.evaluate(expression);const result=JSON.parse(text);
      if(result.ready){
        // 连续两次稳定的完整快照，防止使用骨架屏或加载中途的部分数据。
        const identity=JSON.stringify({range:result.range,cells:result.cells.map(c=>({row:c.row,col:c.col,value:c.value,formula:c.formula}))});
        if(identity===previous){delete result.ready;return result;}previous=identity;
      }else previous=null;
      await wait(700);
    }
    const body=await this.evaluate('(document.body?.innerText||"").slice(0,3000)');
    if(/没有权限|无权访问|文档不存在|文档已删除|访问受限|申请权限/.test(body))throw new Error('腾讯文档访问权限不足或文档已不可用。请在腾讯文档中确认共享权限。');
    throw new Error('腾讯工作表未能完整加载，未更新统计数据。请检查网络、共享权限或腾讯页面是否发生变化。');
  }
  async close(){
    const browser=this.browser;const socket=this.socket;
    if(socket?.readyState===1){try{await this.cdp('Browser.close');}catch(_){}socket.close();}
    this.socket=null;this.browser=null;
    if(browser&&browser.exitCode===null){
      await new Promise(resolve=>{const timer=setTimeout(resolve,1500);browser.once('exit',()=>{clearTimeout(timer);resolve();});});
      if(browser.exitCode===null)await new Promise(resolve=>{const process=spawn('taskkill.exe',['/PID',String(browser.pid),'/T','/F'],{stdio:'ignore'});process.once('exit',resolve);process.once('error',resolve);});
    }
    if(this.profile){try{fs.rmSync(this.profile,{recursive:true,force:true,maxRetries:5,retryDelay:200});}catch(_){/* 仅临时浏览器目录；由缓存清理流程处理，不含应用主数据。 */}this.profile=null;}
  }
}
module.exports={TencentReader,assertSource,RUNTIME_ROOT};
