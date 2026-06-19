$ErrorActionPreference = "Stop"

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$dataPath = Join-Path $repoRoot ".mongo-data"
$logPath = Join-Path $dataPath "mongod.log"

New-Item -ItemType Directory -Force $dataPath | Out-Null

$existing = Get-Process mongod -ErrorAction SilentlyContinue
if ($existing) {
  Write-Output "mongod is already running on this machine."
  exit 0
}

$mongod = (Get-Command mongod).Source
Start-Process `
  -FilePath $mongod `
  -ArgumentList @("--dbpath", $dataPath, "--bind_ip", "127.0.0.1", "--port", "27017", "--logpath", $logPath, "--logappend") `
  -WindowStyle Hidden

Start-Sleep -Seconds 3
Write-Output "Started local MongoDB on mongodb://127.0.0.1:27017/whatscrm"
