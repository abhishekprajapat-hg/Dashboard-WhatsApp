param(
  [string]$SshHost = "72.60.97.58",
  [int]$SshPort = 2424,
  [string]$SshUser = "samvid",
  [int]$LocalTunnelPort = 27018,
  [string]$RemoteMongoHost = "127.0.0.1",
  [int]$RemoteMongoPort = 27017,
  [string]$HostKey = "SHA256:RMC0El7FF7xqTV++Cev0WDzLxJEzujwibiJzTvZGjK4"
)

$ErrorActionPreference = "Stop"

$plink = "C:\Program Files\PuTTY\plink.exe"
if (-not (Test-Path $plink)) {
  throw "PuTTY plink.exe not found at $plink"
}

if (-not $env:DASHBOARD_SSH_PASSWORD) {
  $secure = Read-Host "VPS SSH password" -AsSecureString
  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
  try {
    $env:DASHBOARD_SSH_PASSWORD = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

$remoteEnvCommand = "echo '$($env:DASHBOARD_SSH_PASSWORD)' | sudo -S grep '^MONGODB_URI=' /opt/dashboard-whatsapp/server/.env"
$remoteEnv = & $plink -batch -P $SshPort -hostkey $HostKey -pw $env:DASHBOARD_SSH_PASSWORD "$SshUser@$SshHost" $remoteEnvCommand
$mongoLine = $remoteEnv | Where-Object { $_ -like "MONGODB_URI=*" } | Select-Object -First 1
if (-not $mongoLine) {
  throw "Could not read production MONGODB_URI from VPS."
}

$prodUri = $mongoLine.Substring("MONGODB_URI=".Length)
$prodUri = $prodUri -replace "127\.0\.0\.1:27017", "127.0.0.1:$LocalTunnelPort"
$prodUri = $prodUri -replace "localhost:27017", "127.0.0.1:$LocalTunnelPort"
$prodUri = $prodUri -replace "([?&])replicaSet=[^&]+&?", '$1'
$prodUri = $prodUri -replace "[?&]$", ""
if ($prodUri -like "*?*") {
  $prodUri = "$prodUri&directConnection=true"
} else {
  $prodUri = "$prodUri?directConnection=true"
}

$existingTunnel = Get-NetTCPConnection -LocalPort $LocalTunnelPort -State Listen -ErrorAction SilentlyContinue
if ($existingTunnel) {
  throw "Local port $LocalTunnelPort is already in use. Close the existing process or choose another port."
}

$arguments = @(
  "-batch",
  "-N",
  "-P", "$SshPort",
  "-hostkey", $HostKey,
  "-pw", $env:DASHBOARD_SSH_PASSWORD,
  "-L", "${LocalTunnelPort}:${RemoteMongoHost}:${RemoteMongoPort}",
  "$SshUser@$SshHost"
)

$tunnel = Start-Process -FilePath $plink -ArgumentList $arguments -WindowStyle Hidden -PassThru
try {
  Start-Sleep -Seconds 3
  $env:PROD_MONGODB_URI = $prodUri
  $env:LOCAL_MONGODB_URI = $env:MONGODB_URI
  if (-not $env:LOCAL_MONGODB_URI) {
    $env:LOCAL_MONGODB_URI = "mongodb://127.0.0.1:27017/whatscrm"
  }
  $env:ALLOW_PROD_TO_LOCAL_SYNC = "yes"

  node "$PSScriptRoot\sync-prod-to-local.js"
} finally {
  Remove-Item Env:\PROD_MONGODB_URI -ErrorAction SilentlyContinue
  Remove-Item Env:\LOCAL_MONGODB_URI -ErrorAction SilentlyContinue
  Remove-Item Env:\ALLOW_PROD_TO_LOCAL_SYNC -ErrorAction SilentlyContinue

  if ($tunnel -and -not $tunnel.HasExited) {
    Stop-Process -Id $tunnel.Id -Force
  }
}
