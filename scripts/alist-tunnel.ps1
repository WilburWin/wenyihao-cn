param(
    [Parameter(Mandatory=$true)][ValidatePattern('^[a-zA-Z0-9.-]+$')][string]$ServerHost,
    [Parameter(Mandatory=$true)][string]$IdentityFile,
    [Parameter(Mandatory=$true)][string]$KnownHostsFile,
    [ValidatePattern('^[a-zA-Z0-9_-]+$')][string]$ServerUser='root',
    [ValidateRange(1024,65535)][int]$LocalPort=15244
)
$ErrorActionPreference='Stop'
$taskKey=(Resolve-Path -LiteralPath $IdentityFile).Path
$taskHosts=(Resolve-Path -LiteralPath $KnownHostsFile).Path
Write-Host "AList 后台：http://127.0.0.1:$LocalPort/@login"
Write-Host '保持此窗口运行；按 Ctrl+C 关闭隧道。不会开放服务器公网端口。'
& ssh -N -T -i $taskKey -o BatchMode=yes -o IdentitiesOnly=yes `
  -o StrictHostKeyChecking=yes -o "UserKnownHostsFile=$taskHosts" `
  -o ExitOnForwardFailure=yes -o ConnectTimeout=10 `
  -o ServerAliveInterval=30 -o ServerAliveCountMax=3 `
  -L "127.0.0.1:${LocalPort}:127.0.0.1:5244" "${ServerUser}@${ServerHost}"
if($LASTEXITCODE -ne 0){throw '隧道连接失败，请检查 SSH 连接及本地端口是否已被占用。'}
