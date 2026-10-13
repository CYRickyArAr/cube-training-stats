'use strict';
const RULES=Object.freeze({
 CONFIG_INVALID:['configuration',false,'腾讯源配置无效。'],
 BROWSER_MISSING:['browser_start',false,'未找到 Microsoft Edge。'],
 BROWSER_PERMISSION_DENIED:['browser_start',false,'读取浏览器启动权限不足。'],
 BROWSER_RESOURCE_BUSY:['browser_start',true,'读取浏览器资源暂不可用。'],
 BROWSER_START_FAILED:['browser_start',false,'Edge 读取进程启动失败。'],
 BROWSER_START_TIMEOUT:['browser_start',true,'Edge 启动超时。'],
 DEBUG_ENDPOINT_TIMEOUT:['browser_connect',true,'读取器调试接口连接超时。'],
 DEBUG_ENDPOINT_NETWORK:['browser_connect',true,'读取器调试接口暂不可用。'],
 DEBUG_ENDPOINT_INVALID:['browser_connect',false,'读取器调试接口响应无效。'],
 DEBUG_SOCKET_TIMEOUT:['browser_connect',true,'读取器连接超时。'],
 DEBUG_SOCKET_DISCONNECTED:['browser_connect',true,'读取器连接已断开。'],
 CDP_TIMEOUT:['source_read',true,'腾讯读取操作超时。'],
 CDP_CONTEXT_LOST:['source_read',true,'读取页面上下文暂不可用。'],
 CDP_PROTOCOL_ERROR:['source_read',false,'读取器操作失败。'],
 SOURCE_NAVIGATION_NETWORK:['navigate',true,'腾讯文档页面暂时无法打开。'],
 SOURCE_NAVIGATION_DENIED:['navigate',false,'腾讯文档页面访问被拒绝。'],
 SOURCE_SCRIPT_ERROR:['source_read',false,'腾讯工作表读取异常。'],
 SOURCE_LIMIT_EXCEEDED:['source_read',false,'工作表超过完整读取上限。'],
 SOURCE_INCOMPLETE_TIMEOUT:['source_read',true,'腾讯工作表未能完整加载。'],
 SOURCE_PERMISSION_DENIED:['source_read',false,'腾讯文档访问权限不足或文档不可用。'],
 READ_ATTEMPT_TIMEOUT:['source_read',true,'本次读取超时。'],
 READ_TOTAL_TIMEOUT:['source_read',false,'读取总时限已用尽。'],
 READER_CLEANUP_FAILED:['cleanup',false,'读取器清理失败。'],
 UNCLASSIFIED_READ_ERROR:['source_read',false,'读取失败，原因尚未分类。'],
 DATA_INVALID:['conversion',false,'数据转换校验失败。'],
 PRIVACY_BLOCKED:['privacy',false,'Publication blocked: private source information detected.'],
 ASSET_INVALID:['assets',false,'公开页面或资源校验失败。'],
 OUTPUT_FAILED:['output',false,'公开快照写入失败。'],
});
const STAGES=new Set(Object.values(RULES).map(rule=>rule[0]));
class SourceFailure extends Error{
 constructor(code,stage,attempt=0){
  if(!Object.hasOwn(RULES,code))code='UNCLASSIFIED_READ_ERROR';
  const rule=RULES[code];super(rule[2]);this.name='SourceFailure';
  Object.defineProperties(this,{code:{value:code,enumerable:true},stage:{value:STAGES.has(stage)?stage:rule[0],enumerable:true},retryable:{value:rule[1],enumerable:true},attempt:{value:Number.isInteger(attempt)&&attempt>=0&&attempt<=3?attempt:0,enumerable:true}});
 }
}
function failureFrom(error,fallback='UNCLASSIFIED_READ_ERROR',stage,attempt){
 return error instanceof SourceFailure?new SourceFailure(error.code,error.stage,attempt??error.attempt):new SourceFailure(fallback,stage,attempt);
}
module.exports={SourceFailure,failureFrom};
