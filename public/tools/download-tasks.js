// Task data is never interpolated into shell code. Only the downloader follows file redirects.
const clean=value=>{
  let name=value.replace(/[<>:"/\\|?*\x00-\x1f\x7f]/g,'_').replace(/[. ]+$/,'')||'_';
  if(/^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/i.test(name))name='_'+name;
  return name;
};
export function prepareTask(task,files,origin,folder='Downloads-'+Date.now()+'-'+crypto.randomUUID().slice(0,8)){
  if(!Array.isArray(files)||!files.length||files.length>50000)throw Error('文件清单为空或过大。');
  if(!/^[a-f0-9]{64}$/.test(task.token)||!['/api/tools/payments/file','/api/tools/downloads/file'].includes(task.endpoint))throw Error('下载任务无效。');
  if(!/^Downloads-[a-zA-Z0-9-]+$/.test(folder))throw Error('保存目录无效。');
  const base=task.kind==='file'?task.path.slice(0,task.path.lastIndexOf('/')):task.path==='/'?'':task.path;
  const partFolder='_Download_parts',seen=new Set(),names=new Map(),used=new Map([['',new Set([partFolder.toLowerCase()])]]);
  const entries=[...files].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0).map(file=>{
    if(typeof file.path!=='string'||!file.path.startsWith(base+'/')||seen.has(file.path)||!Number.isSafeInteger(file.size)||file.size<0)throw Error('文件清单无效。');
    seen.add(file.path);
    const parts=file.path.slice(base.length+1).split('/');
    if(parts.some(p=>!p||p==='.'||p==='..'||/[\\\x00-\x1f\x7f]/.test(p)))throw Error('文件路径无效。');
    let original='',parent='';const safe=[];
    for(const part of parts){
      original+='/'+part;
      if(!names.has(original)){
        const siblings=used.get(parent)||new Set();used.set(parent,siblings);
        const stem=clean(part);let candidate=stem,index=1;
        while(siblings.has(candidate.toLowerCase()))candidate=stem+' ('+(++index)+')';
        siblings.add(candidate.toLowerCase());names.set(original,candidate);
      }
      safe.push(names.get(original));parent=original;
    }
    const url=new URL(task.endpoint,origin);url.searchParams.set('task',task.token);url.searchParams.set('path',file.path);
    if(!['https:','http:'].includes(url.protocol)||url.origin!==new URL(origin).origin)throw Error('任务地址无效。');
    return {relative:safe.join('\\'),size:file.size,url:url.href};
  });
  return {folder,partFolder,entries,expiresAt:task.expiresAt};
}
// Plain PowerShell lives after exit /b, keeping CMD's command line below 8191 characters.
// The bootstrap executes only this static runner; the appended JSON remains data.
const powershell=String.raw`
$ErrorActionPreference='Stop'
try { [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false) } catch {}
$process=$null
$view=@{Top=-1;Width=0;Current=0.0;Saved=0.0;Total=0.0;Completed=0;Failed=0;Index=0;Count=0;Size=0.0;Speed=0.0;State='准备下载';Name='';LastState='';LastIndex=-1}
$display=@{Rows=@();Clock=[Diagnostics.Stopwatch]::StartNew();LastDraw=-1000.0;Initialized=$false;CursorSaved=$false;CursorVisible=$true;Virtual=$false;Handle=[IntPtr]::Zero;OriginalMode=[uint32]0}
function Initialize-Display {
  if ($display.Initialized) { return }
  $display.Initialized=$true
  try { $display.CursorVisible=[Console]::CursorVisible;$display.CursorSaved=$true;[Console]::CursorVisible=$false } catch {}
  try {
    if (!('DownloadConsoleMode' -as [type])) {
      Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class DownloadConsoleMode {
  [DllImport("kernel32.dll")] public static extern IntPtr GetStdHandle(int id);
  [DllImport("kernel32.dll")] public static extern bool GetConsoleMode(IntPtr handle, out uint mode);
  [DllImport("kernel32.dll")] public static extern bool SetConsoleMode(IntPtr handle, uint mode);
}
'@
    }
    $handle=[DownloadConsoleMode]::GetStdHandle(-11);$mode=[uint32]0
    if ([DownloadConsoleMode]::GetConsoleMode($handle,[ref]$mode) -and [DownloadConsoleMode]::SetConsoleMode($handle,($mode -bor 4))) {
      $display.Handle=$handle;$display.OriginalMode=$mode;$display.Virtual=$true
    }
  } catch {}
}
function Restore-Display {
  if ($display.Virtual) { try { [void][DownloadConsoleMode]::SetConsoleMode($display.Handle,$display.OriginalMode) } catch {}; $display.Virtual=$false }
  if ($display.CursorSaved) { try { [Console]::CursorVisible=$display.CursorVisible } catch {}; $display.CursorSaved=$false }
}
function File-Length($path) {
  if ([IO.File]::Exists($path)) { return [double]([IO.FileInfo]::new($path).Length) }
  return 0.0
}
function Format-Size([double]$bytes) {
  if ($bytes -ge 1e9) { return ('{0:0.00} GB' -f ($bytes/1e9)) }
  if ($bytes -ge 1e6) { return ('{0:0.00} MB' -f ($bytes/1e6)) }
  if ($bytes -ge 1e3) { return ('{0:0.0} KB' -f ($bytes/1e3)) }
  return ('{0:0} B' -f $bytes)
}
function Format-Time([double]$remaining,[double]$speed) {
  if ($remaining -le 0) { return '00:00' }
  if ($speed -le 0) { return '--:--' }
  $seconds=[Math]::Ceiling($remaining/$speed)
  return ('{0:00}:{1:00}:{2:00}' -f [Math]::Floor($seconds/3600),[Math]::Floor(($seconds%3600)/60),($seconds%60))
}
function Quote-Argument([string]$value) {
  return '"'+(($value -replace '(\\*)"','$1$1\"') -replace '(\\+)$','$1$1')+'"'
}
function Fit-Line([string]$line,[int]$width) {
  $result=[Text.StringBuilder]::new();$cells=0
  foreach ($character in $line.ToCharArray()) {
    $code=[int]$character
    $size=1
    if (($code -ge 0x1100 -and $code -le 0x115f) -or ($code -ge 0x2e80 -and $code -le 0xa4cf) -or ($code -ge 0xac00 -and $code -le 0xd7a3) -or ($code -ge 0xf900 -and $code -le 0xfaff) -or ($code -ge 0xfe10 -and $code -le 0xfe6f) -or ($code -ge 0xff01 -and $code -le 0xff60) -or ($code -ge 0xffe0 -and $code -le 0xffe6)) { $size=2 }
    if ($cells+$size -gt $width-3) { [void]$result.Append('...');$cells+=3;break }
    [void]$result.Append($character);$cells+=$size
  }
  return $result.ToString()+(' '*[Math]::Max(0,$width-$cells))
}
function Show-Progress([bool]$force=$false) {
  $changed=$view.LastState -ne $view.State -or $view.LastIndex -ne $view.Index
  if (!$force -and !$changed -and $display.Clock.Elapsed.TotalMilliseconds-$display.LastDraw -lt 1000) { return }
  $percent=if ($view.Size -gt 0) { [Math]::Min(100,[Math]::Floor(100*$view.Current/$view.Size)) } else { if ($view.State -eq '完成') { 100 } else { 0 } }
  $overall=if ($view.Total -gt 0) { [Math]::Min(100,[Math]::Floor(100*$view.Saved/$view.Total)) } else { if ($view.Completed -eq $view.Count) { 100 } else { 0 } }
  $blocks=[int][Math]::Floor($percent*30/100)
  $speedText=if ($view.Speed -gt 0) { (Format-Size $view.Speed)+'/s' } elseif ($view.State -eq '下载中') { '等待数据...' } else { '--' }
  $lines=@(
    '批量下载',
    '',
    ('[{0}/{1}] {2}' -f $view.Index,$view.Count,$view.State),
    $view.Name,
    '',
    ('['+('#'*$blocks)+('-'*(30-$blocks))+'] '+$percent+'%'),
    ('已下载：'+(Format-Size $view.Current)+' / '+(Format-Size $view.Size)),
    ('速  度：'+$speedText),
    ('剩  余：'+(Format-Time ($view.Size-$view.Current) $view.Speed)),
    '',
    ('总进度：'+$overall+'%  |  已完成：'+$view.Completed+'/'+$view.Count+'  |  失败：'+$view.Failed)
  )
  $interactive=$false
  try { $interactive=![Console]::IsOutputRedirected -and [Console]::BufferWidth -ge 48 -and [Console]::BufferHeight -gt $lines.Count+1 } catch {}
  if ($interactive) {
    try {
      Initialize-Display
      $width=[Math]::Min([Console]::WindowWidth,[Console]::BufferWidth)-1
      if ($view.Top -lt 0 -or $view.Width -ne $width) {
        [Console]::Write([string]::new([char]10,$lines.Count));$view.Top=[Math]::Max(0,[Console]::CursorTop-$lines.Count);$view.Width=$width
        $display.Rows=@()
      }
      $nextRows=@($lines | ForEach-Object { Fit-Line $_ $width })
      $batch=[Text.StringBuilder]::new();$escape=[string][char]27;$written=$false
      for ($row=0;$row -lt $lines.Count;$row++) {
        if ($row -lt $display.Rows.Count -and $display.Rows[$row] -ceq $nextRows[$row]) { continue }
        if ($display.Virtual) {
          [void]$batch.Append($escape+'['+($view.Top+$row+1)+';1H'+$nextRows[$row])
        } else {
          [Console]::SetCursorPosition(0,$view.Top+$row);[Console]::Write($nextRows[$row])
        }
        $written=$true
      }
      if ($written) {
        if ($display.Virtual) { [void]$batch.Append($escape+'['+($view.Top+$lines.Count+1)+';1H');[Console]::Write($batch.ToString()) }
        else { [Console]::SetCursorPosition(0,$view.Top+$lines.Count) }
      }
      $display.Rows=$nextRows;$display.LastDraw=$display.Clock.Elapsed.TotalMilliseconds
      $view.LastState=$view.State;$view.LastIndex=$view.Index
      return
    } catch { $view.Top=-1;$display.Rows=@();Restore-Display }
  }
  if ($force -or $view.LastState -ne $view.State -or $view.LastIndex -ne $view.Index) {
    foreach ($line in $lines) { Write-Host $line }
    $view.LastState=$view.State;$view.LastIndex=$view.Index
  }
  $display.LastDraw=$display.Clock.Elapsed.TotalMilliseconds
}
try {
  $text=[IO.File]::ReadAllText($env:DOWNLOAD_TASK)
  $marker='DOWNLOAD_'+'TASK_DATA:'
  $task=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($text.Substring($text.LastIndexOf($marker)+$marker.Length).Trim())) | ConvertFrom-Json
  $curl=(Get-Command curl.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
  $root=Join-Path ([IO.Path]::GetDirectoryName($env:DOWNLOAD_TASK)) $task.folder
  [void][IO.Directory]::CreateDirectory($root)
  $parts=Join-Path $root $task.partFolder;[void][IO.Directory]::CreateDirectory($parts)
  $view.Count=@($task.entries).Count
  $positions=[Collections.Generic.List[double]]::new();$number=0
  foreach ($item in $task.entries) {
    $number++;$destination=Join-Path $root $item.relative;$temporary=Join-Path $parts ($number.ToString()+'.part')
    $already=[IO.File]::Exists($destination) -and (File-Length $destination) -eq $item.size
    $existing=if ($already) { [double]$item.size } else { [Math]::Min([double]$item.size,(File-Length $temporary)) }
    $positions.Add($existing);$view.Saved+=$existing;$view.Total+=[double]$item.size
    if ($already) { $view.Completed++ }
  }
  foreach ($entry in $task.entries) {
    $view.Index++;$view.Name=$entry.relative;$view.Size=[double]$entry.size;$view.Current=$positions[$view.Index-1];$view.Speed=0.0;$view.State='准备下载'
    $dest=Join-Path $root $entry.relative;$part=Join-Path $parts ($view.Index.ToString()+'.part');$process=$null
    try {
      [void][IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($dest))
      if ([IO.File]::Exists($dest)) {
        if ((File-Length $dest) -ne $entry.size) { throw '已有同名文件大小不同，已保留原文件。' }
        $view.State='已完成，跳过';Show-Progress;continue
      }
      if ([IO.File]::Exists($part) -and (File-Length $part) -eq $entry.size) {
        [IO.File]::Move($part,$dest);$view.Completed++;$view.State='完成';Show-Progress;continue
      }
      if ((File-Length $part) -gt $entry.size) { throw '临时文件大小异常，请检查后重试。' }
      $arguments=@('--location','--fail','--silent','--show-error','--continue-at','-','--user-agent','pan.baidu.com','--proto','=https','--proto-redir','=https','--retry','2','--retry-delay','2','--connect-timeout','20','--output',$part,$entry.url)
      $start=[Diagnostics.ProcessStartInfo]::new();$start.FileName=$curl;$start.Arguments=($arguments | ForEach-Object { Quote-Argument $_ }) -join ' '
      $start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardError=$true;$start.RedirectStandardOutput=$true
      $process=[Diagnostics.Process]::new();$process.StartInfo=$start
      [void]$process.Start();$errorRead=$process.StandardError.ReadToEndAsync();$outputRead=$process.StandardOutput.ReadToEndAsync()
      $clock=[Diagnostics.Stopwatch]::StartNew();$lastAt=0.0;$lastBytes=File-Length $part
      $view.State='下载中';Show-Progress
      while (!$process.WaitForExit(250)) {
        $current=[Math]::Min($view.Size,(File-Length $part));$view.Saved+=$current-$view.Current;$view.Current=$current
        $elapsed=$clock.Elapsed.TotalSeconds-$lastAt
        if ($elapsed -ge 1) { $view.Speed=[Math]::Max(0,($current-$lastBytes)/$elapsed);$lastAt=$clock.Elapsed.TotalSeconds;$lastBytes=$current }
        Show-Progress
      }
      $process.WaitForExit();[void]$errorRead.GetAwaiter().GetResult();[void]$outputRead.GetAwaiter().GetResult()
      $current=[Math]::Min($view.Size,(File-Length $part));$view.Saved+=$current-$view.Current;$view.Current=$current
      if ($process.ExitCode -ne 0) { throw ('下载失败（代码 '+$process.ExitCode+'），已保留进度。可重跑任务或回网站重新生成。') }
      if (![IO.File]::Exists($part) -or (File-Length $part) -ne $entry.size) { throw '文件尚未完整下载，重新运行可继续。' }
      [IO.File]::Move($part,$dest);$view.Completed++;$view.State='完成';$view.Speed=0.0;Show-Progress
    } catch {
      $view.Failed++;$view.State='失败，继续下一个';$view.Speed=0.0;Show-Progress $true
      [IO.File]::AppendAllText((Join-Path $parts 'errors.txt'),($entry.relative+'：'+$_.Exception.Message+[Environment]::NewLine),[Text.UTF8Encoding]::new($false))
    } finally {
      if ($null -ne $process) { try { if (!$process.HasExited) { $process.Kill();$process.WaitForExit() } } catch {}; $process.Dispose();$process=$null }
    }
  }
  Restore-Display
  Write-Host ('保存位置：'+$root)
  if ($view.Failed) { throw ('有 '+$view.Failed+' 个文件未完成。重新运行可续传，详情见临时目录中的 errors.txt。') }
  Write-Host '全部文件下载完成。' -ForegroundColor Green
} catch {
  Restore-Display
  Write-Host $_.Exception.Message -ForegroundColor Red
  Read-Host '按回车键关闭窗口' | Out-Null
  exit 1
} finally {
  Restore-Display
  if ($null -ne $process) { try { if (!$process.HasExited) { $process.Kill() } } catch {}; $process.Dispose() }
}
Read-Host '按回车键关闭窗口' | Out-Null
`;
export function windowsTask(task){
  const bytes=new TextEncoder().encode(JSON.stringify(task));let binary='';
  for(const byte of bytes)binary+=String.fromCharCode(byte);
  const bootstrap="$text=[IO.File]::ReadAllText($env:DOWNLOAD_TASK);$start='DOWNLOAD_'+'SCRIPT:';$end='DOWNLOAD_'+'TASK_DATA:';$a=$text.LastIndexOf($start)+$start.Length;$b=$text.LastIndexOf($end);& ([ScriptBlock]::Create($text.Substring($a,$b-$a)))";
  return ['@echo off','setlocal DisableDelayedExpansion','set "DOWNLOAD_TASK=%~f0"','powershell.exe -NoProfile -Command "'+bootstrap+'"','exit /b %errorlevel%','DOWNLOAD_SCRIPT:',powershell.replaceAll('\n','\r\n'),'DOWNLOAD_TASK_DATA:',btoa(binary),''].join('\r\n');
}
export function aria2Task(task){
  return task.entries.map(entry=>[entry.url,'  dir='+task.folder+(entry.relative.includes('\\')?'/'+entry.relative.slice(0,entry.relative.lastIndexOf('\\')).replaceAll('\\','/') : ''),'  out='+entry.relative.split('\\').at(-1),'  user-agent=pan.baidu.com','  continue=true','  auto-file-renaming=false','  allow-overwrite=false','  max-tries=3'].join('\n')).join('\n')+'\n';
}
export function saveTask(task,type='windows'){
  const blob=new Blob([type==='windows'?windowsTask(task):aria2Task(task)],{type:'application/octet-stream'}),url=URL.createObjectURL(blob);
  const anchor=document.createElement('a');anchor.href=url;anchor.download=task.folder+(type==='windows'?'.cmd':'.aria2.txt');document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
