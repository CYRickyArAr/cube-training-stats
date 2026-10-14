'use strict';
const fs=require('node:fs');const path=require('node:path');const {spawn}=require('node:child_process');
const {SourceFailure}=require('./source-errors.cjs');
// Only exact temporary-profile owners and their verified descendants are eligible.
const SCRIPT=String.raw`
$ErrorActionPreference='Stop'
try {
 $r=[Console]::In.ReadToEnd() | ConvertFrom-Json
 $profile=[IO.Path]::GetFullPath($r.profile)
 function Inventory {
  $all=@(Get-CimInstance Win32_Process -Filter "Name='msedge.exe'")
  $owned=@{}
  foreach($p in $all) {
   $m=[regex]::Match([string]$p.CommandLine,'(?i)(?:^|\s)(?:"--user-data-dir=([^"]+)"|--user-data-dir="([^"]+)"|--user-data-dir=([^\s"]+))')
   if($m.Success) {
    $v=($m.Groups | Select-Object -Skip 1 | Where-Object Success | Select-Object -First 1).Value
    if([IO.Path]::GetFullPath($v) -ieq $profile) {$owned[[string]$p.ProcessId]=$p}
   }
   foreach($proof in @($r.proofs)) {
    if($p.ProcessId -eq $proof.pid -and $p.CreationDate.ToUniversalTime().Ticks.ToString() -eq $proof.created) {$owned[[string]$p.ProcessId]=$p}
   }
  }
  do {
   $added=$false
   foreach($p in $all) {
    $parent=$owned[[string]$p.ParentProcessId]
    if($parent -and !$owned.ContainsKey([string]$p.ProcessId) -and $p.CreationDate -ge $parent.CreationDate) {$owned[[string]$p.ProcessId]=$p;$added=$true}
   }
  } while($added)
  return @($owned.Values)
 }
 $initial=@(Inventory)
 if($r.mode -eq 'capture') {
  if($r.launcherPid -and ($initial.ProcessId -notcontains $r.launcherPid)) {
   $live=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$r.launcherPid)
   if($live) {throw 'unconfirmed'}
  }
  $proofs=@($initial | ForEach-Object {@{pid=[int]$_.ProcessId;created=$_.CreationDate.ToUniversalTime().Ticks.ToString()}})
  @{proofs=$proofs} | ConvertTo-Json -Compress -Depth 4
 } elseif($r.mode -eq 'settle') {
  $r.proofs=@($r.proofs)+@($initial | ForEach-Object {@{pid=[int]$_.ProcessId;created=$_.CreationDate.ToUniversalTime().Ticks.ToString()}})
  $end=[DateTime]::UtcNow.AddMilliseconds(1000)
  do {$remaining=@(Inventory);if(!$remaining.Count){break};Start-Sleep -Milliseconds 150} while([DateTime]::UtcNow -lt $end)
  $terminated=0
  foreach($p in ($remaining | Sort-Object CreationDate -Descending)) {
   $current=$null
   try {
    try {$current=[Diagnostics.Process]::GetProcessById([int]$p.ProcessId)} catch [ArgumentException] {continue}
    # Pin the process handle before checking identity, so PID reuse cannot redirect Kill.
    $null=$current.Handle
    if($current.HasExited){continue}
    $ticks=$current.StartTime.ToUniversalTime().Ticks
    # CIM timestamps have microsecond precision; native FILETIME has 100ns precision.
    if($current.ProcessName -ne 'msedge' -or ($ticks-($ticks%10)) -ne $p.CreationDate.ToUniversalTime().Ticks){continue}
    $current.Kill();$terminated++
   } catch {
    if(!$current -or !$current.HasExited){throw 'termination'}
   } finally {if($current){$current.Dispose()}}
  }
  $end=[DateTime]::UtcNow.AddMilliseconds(2000)
  do {$remaining=@(Inventory);if(!$remaining.Count){break};Start-Sleep -Milliseconds 150} while([DateTime]::UtcNow -lt $end)
  if($remaining.Count){throw 'unconfirmed'}
  @{remaining=0;terminated=$terminated} | ConvertTo-Json -Compress
 } else {throw 'unconfirmed'}
} catch {
 $code=if($_.Exception.Message -eq 'termination'){'READER_PROCESS_TERMINATION_FAILED'}else{'READER_PROCESS_UNCONFIRMED'}
 @{code=$code} | ConvertTo-Json -Compress
 exit 1
}
`;
function assertOwnedProfile(profile,runtimeRoot){
 const target=path.resolve(profile),root=path.resolve(runtimeRoot),norm=v=>process.platform==='win32'?v.toLowerCase():v;
 if(path.dirname(norm(target))!==norm(root)||!/^reader-[A-Za-z0-9]+$/.test(path.basename(target)))throw new SourceFailure('READER_CLEANUP_FAILED','cleanup',0,{operation:'profile_remove'});
 return target;
}
function processRequest(request){
 if(process.platform!=='win32')return Promise.reject(new SourceFailure('READER_PROCESS_UNCONFIRMED','cleanup',0,{operation:'process_inventory'}));
 return new Promise((resolve,reject)=>{
  const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(SCRIPT,'utf16le').toString('base64')],{windowsHide:true,stdio:['pipe','pipe','ignore']});let text='',done=false;
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);error?reject(error):resolve(value);};
  const fail=code=>new SourceFailure(code,'cleanup',0,{operation:request.mode==='settle'?'process_termination':'process_inventory'});
  const timer=setTimeout(()=>{child.kill();finish(fail('READER_PROCESS_UNCONFIRMED'));},10000);
  child.stdout.on('data',chunk=>{text+=chunk;if(text.length>65536){child.kill();finish(fail('READER_PROCESS_UNCONFIRMED'));}});
  child.once('error',()=>finish(fail('READER_PROCESS_UNCONFIRMED')));
  child.once('close',code=>{let value;try{value=JSON.parse(text);}catch{return finish(fail('READER_PROCESS_UNCONFIRMED'));}if(code!==0)return finish(fail(value.code==='READER_PROCESS_TERMINATION_FAILED'?value.code:'READER_PROCESS_UNCONFIRMED'));finish(null,value);});
  child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify(request));
 });
}
async function removeProfile(profile,{remove=target=>fs.promises.rm(target,{recursive:true,force:true,maxRetries:0}),wait=ms=>new Promise(resolve=>setTimeout(resolve,ms)),onDiagnostic=()=>{}}={}){
 let last;for(let attempt=1;attempt<=6;attempt++){
  try{await remove(profile);if(attempt>1)onDiagnostic({event:'reader_cleanup_recovered',stage:'cleanup',code:'PROFILE_REMOVED',cleanupAttempt:attempt});return;}
  catch(error){last=error;if(!['EBUSY','EPERM','ENOTEMPTY'].includes(error.code)||attempt===6)break;await wait(200*attempt);}
 }
 throw new SourceFailure(['EBUSY','EPERM','ENOTEMPTY'].includes(last?.code)?'READER_PROFILE_BUSY':'READER_CLEANUP_FAILED','cleanup',0,{operation:'profile_remove',osCode:last?.code||'UNKNOWN'});
}
module.exports={assertOwnedProfile,processRequest,removeProfile};

