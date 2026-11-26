param(
    [int]$BbPort = 0,
    [int]$EgressPort = 0,
    [int]$BridgePort = 0,
    [int]$HubPort = 0,
    [int]$MegaPort = 0,
    [string]$MegaHost = '',
    [switch]$NoLoops
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$Root = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $Root '.runtime'
$LogDir = Join-Path $RuntimeDir 'logs'
$PidFile = Join-Path $RuntimeDir 'pids.json'

New-Item -ItemType Directory -Path $LogDir -Force | Out-Null

# 1. Opsiyonel .env yukle
$envFile = Join-Path $Root '.env'
if (Test-Path -LiteralPath $envFile) {
    foreach ($rawLine in (Get-Content -LiteralPath $envFile -Encoding UTF8)) {
        $line = $rawLine.Trim()
        if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith('#')) {
            continue
        }
        $idx = $line.IndexOf('=')
        if ($idx -le 0) { continue }
        $key = $line.Substring(0, $idx).Trim()
        $val = $line.Substring($idx + 1).Trim()
        if (($val.Length -ge 2) -and ((($val.StartsWith('"')) -and ($val.EndsWith('"'))) -or (($val.StartsWith("'")) -and ($val.EndsWith("'"))))) {
            $val = $val.Substring(1, $val.Length - 2)
        }
        if (-not [string]::IsNullOrWhiteSpace($key)) {
            [Environment]::SetEnvironmentVariable($key, $val, 'Process')
        }
    }
}

function Resolve-Port {
    param([int]$CliVal, [string[]]$EnvNames, [int]$DefaultVal)
    if ($CliVal -gt 0) { return $CliVal }
    foreach ($n in $EnvNames) {
        $v = [Environment]::GetEnvironmentVariable($n, 'Process')
        if (-not [string]::IsNullOrWhiteSpace($v)) {
            $parsed = 0
            if ([int]::TryParse($v.Trim(), [ref]$parsed) -and ($parsed -gt 0)) {
                return $parsed
            }
        }
    }
    return $DefaultVal
}

$bbP = Resolve-Port -CliVal $BbPort -EnvNames @('BB_PORT') -DefaultVal 7200
$egressP = Resolve-Port -CliVal $EgressPort -EnvNames @('EGRESS_PORT') -DefaultVal 7301
$bridgeP = Resolve-Port -CliVal $BridgePort -EnvNames @('BRIDGE_PORT') -DefaultVal 7000
$hubP = Resolve-Port -CliVal $HubPort -EnvNames @('HUB_PORT') -DefaultVal 7100
$megaP = Resolve-Port -CliVal $MegaPort -EnvNames @('MEGA_PORT', 'PORT') -DefaultVal 3001

if (-not [string]::IsNullOrWhiteSpace($MegaHost)) {
    $megaH = $MegaHost.Trim()
} elseif (-not [string]::IsNullOrWhiteSpace($env:MEGA_HOST)) {
    $megaH = $env:MEGA_HOST.Trim()
} elseif (-not [string]::IsNullOrWhiteSpace($env:HOST)) {
    $megaH = $env:HOST.Trim()
} else {
    $megaH = '127.0.0.1'
}

# 2. Alt sureclere miras kalacak env degiskenleri
$env:BB_PORT = [string]$bbP
$env:EGRESS_PORT = [string]$egressP
$env:EGRESS_HOST = '127.0.0.1'
$env:BRIDGE_PORT = [string]$bridgeP
$env:BRIDGE_HOST = '127.0.0.1'
$env:BRIDGE_ORIGIN = ('http://127.0.0.1:' + $bridgeP)
$env:BB_HOST = ('http://127.0.0.1:' + $bbP)
$env:HUB_PORT = [string]$hubP
$env:HUB_HOST = '127.0.0.1'
$env:UNIFIED_PORT = [string]$hubP
if ([string]::IsNullOrWhiteSpace($env:NU_CONC)) {
    $env:NU_CONC = '16'
}
$env:PORT = [string]$megaP
$env:HOST = $megaH
$env:HUB_URL = ('http://127.0.0.1:' + $hubP)

# node.exe bul
$nodeExe = $null
$nodeCmd = Get-Command node.exe -ErrorAction SilentlyContinue
if ($nodeCmd) {
    $nodeExe = $nodeCmd.Source
} elseif (Test-Path -LiteralPath 'C:\Program Files\nodejs\node.exe') {
    $nodeExe = 'C:\Program Files\nodejs\node.exe'
}
if (-not $nodeExe) {
    throw 'node.exe bulunamadi. Once kur.bat dosyasini calistirin.'
}

function Test-TcpPort {
    param([string]$HostName, [int]$Port)
    $client = New-Object System.Net.Sockets.TcpClient
    try {
        $iar = $client.BeginConnect($HostName, $Port, $null, $null)
        $ok = $iar.AsyncWaitHandle.WaitOne(400, $false)
        if ($ok -and $client.Connected) {
            $client.EndConnect($iar)
            return $true
        }
        return $false
    } catch {
        return $false
    } finally {
        $client.Close()
    }
}

function Wait-HttpOk {
    param([string]$Url, [int]$TimeoutSec)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        try {
            $resp = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 3
            if (($resp.StatusCode -ge 200) -and ($resp.StatusCode -lt 400)) {
                return $true
            }
        } catch {
        }
        Start-Sleep -Milliseconds 500
    }
    return $false
}

function Wait-TcpOk {
    param([int]$Port, [int]$TimeoutSec)
    $deadline = (Get-Date).AddSeconds($TimeoutSec)
    while ((Get-Date) -lt $deadline) {
        if (Test-TcpPort -HostName '127.0.0.1' -Port $Port) {
            return $true
        }
        Start-Sleep -Milliseconds 400
    }
    return $false
}

$tracked = New-Object System.Collections.Generic.List[object]
if (Test-Path -LiteralPath $PidFile) {
    try {
        $prev = Get-Content -LiteralPath $PidFile -Raw | ConvertFrom-Json
        if ($prev -and $prev.processes) {
            foreach ($item in $prev.processes) {
                if ($item.pid -and (Get-Process -Id ([int]$item.pid) -ErrorAction SilentlyContinue)) {
                    $tracked.Add($item)
                }
            }
        }
    } catch {
    }
}

function Start-ServiceProc {
    param(
        [string]$Name,
        [int]$Port,
        [string]$FilePath,
        [string[]]$ArgumentList,
        [string]$WorkingDirectory
    )
    if (($Port -gt 0) -and (Test-TcpPort -HostName '127.0.0.1' -Port $Port)) {
        Write-Host ('[ATLA] ' + $Name + ' zaten dinliyor (port ' + $Port + ')') -ForegroundColor DarkYellow
        return $null
    }

    $outLog = Join-Path $LogDir ($Name + '.out.log')
    $errLog = Join-Path $LogDir ($Name + '.err.log')

    if ($NoLoops) {
        $p = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
    } else {
        $loopScript = Join-Path $RuntimeDir ('loop-' + $Name + '.ps1')
        $escapedArgs = ($ArgumentList | ForEach-Object { "'" + ($_ -replace "'", "''") + "'" }) -join ' '
        $loopBody = @(
            '$ErrorActionPreference = "Continue"'
            "Set-Location -LiteralPath '" + ($WorkingDirectory -replace "'", "''") + "'"
            'while ($true) {'
            "    try {"
            "        & '" + ($FilePath -replace "'", "''") + "' " + $escapedArgs + " >> '" + ($outLog -replace "'", "''") + "' 2>> '" + ($errLog -replace "'", "''") + "'"
            "    } catch {}"
            "    Start-Sleep -Seconds 3"
            "}"
        ) -join [Environment]::NewLine
        Set-Content -LiteralPath $loopScript -Value $loopBody -Encoding UTF8
        $psExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
        $p = Start-Process -FilePath $psExe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', $loopScript) -WorkingDirectory $WorkingDirectory -WindowStyle Hidden -PassThru
    }

    $entry = [PSCustomObject]@{
        name = $Name
        port = $Port
        pid = $p.Id
        startedAt = (Get-Date).ToString('o')
    }
    $tracked.Add($entry)
    Write-Host ('[BASLAT] ' + $Name + ' (port ' + $Port + ', PID ' + $p.Id + ')') -ForegroundColor Cyan
    return $p
}

Write-Host '=== Lanettirr Nuvio Hub Baslatiliyor ===' -ForegroundColor Cyan

# 3. Sirali servis baslatma
$cmdExe = Join-Path $env:WINDIR 'System32\cmd.exe'
Start-ServiceProc -Name 'cs-host' -Port $bbP -FilePath $cmdExe -ArgumentList @('/c', 'run-host.cmd') -WorkingDirectory (Join-Path $Root 'cs-host') | Out-Null
$csOk = Wait-HttpOk -Url ('http://127.0.0.1:' + $bbP + '/health') -TimeoutSec 25

Start-ServiceProc -Name 'egress' -Port $egressP -FilePath $nodeExe -ArgumentList @('egress.mjs') -WorkingDirectory (Join-Path $Root 'egress') | Out-Null
$egOk = Wait-TcpOk -Port $egressP -TimeoutSec 10

Start-ServiceProc -Name 'kraptor-bridge' -Port $bridgeP -FilePath $nodeExe -ArgumentList @('server.mjs') -WorkingDirectory (Join-Path $Root 'kraptor-bridge') | Out-Null
$brOk = Wait-TcpOk -Port $bridgeP -TimeoutSec 15

Start-ServiceProc -Name 'trhub' -Port $hubP -FilePath $nodeExe -ArgumentList @('hub.mjs') -WorkingDirectory (Join-Path $Root 'trhub') | Out-Null
$hubOk = Wait-HttpOk -Url ('http://127.0.0.1:' + $hubP + '/en-repo/manifest.json') -TimeoutSec 25

Start-ServiceProc -Name 'mega-bridge' -Port $megaP -FilePath $nodeExe -ArgumentList @('index.js') -WorkingDirectory (Join-Path $Root 'mega-bridge') | Out-Null
$megaOk = Wait-HttpOk -Url ('http://127.0.0.1:' + $megaP + '/health') -TimeoutSec 20

# 4. Opsiyonel Cloudflare Tunnel + AIOStreams senkronizasyonu
$tunnelEnabled = ($env:ENABLE_TUNNEL -eq '1') -or ($env:ENABLE_TUNNEL -eq 'true')
if ($tunnelEnabled) {
    $cfExe = $null
    $cfCmd = Get-Command cloudflared.exe -ErrorAction SilentlyContinue
    if ($cfCmd) {
        $cfExe = $cfCmd.Source
    } elseif (Test-Path -LiteralPath (Join-Path $Root 'cloudflared.exe')) {
        $cfExe = Join-Path $Root 'cloudflared.exe'
    }
    if ($cfExe) {
        $cfOut = Join-Path $LogDir 'cloudflared.out.log'
        $cfErr = Join-Path $LogDir 'cloudflared.err.log'
        Remove-Item -LiteralPath $cfErr -Force -ErrorAction SilentlyContinue
        $cfProc = Start-Process -FilePath $cfExe -ArgumentList @('tunnel', '--url', ('http://127.0.0.1:' + $megaP), '--no-autoupdate') -WorkingDirectory $Root -WindowStyle Hidden -RedirectStandardOutput $cfOut -RedirectStandardError $cfErr -PassThru
        $tracked.Add([PSCustomObject]@{ name = 'cloudflared'; port = 0; pid = $cfProc.Id; startedAt = (Get-Date).ToString('o') })
        Write-Host ('[BASLAT] cloudflared (PID ' + $cfProc.Id + '), tunel URL bekleniyor...') -ForegroundColor Cyan
        $tunnelUrl = ''
        $deadline = (Get-Date).AddSeconds(20)
        while ((Get-Date) -lt $deadline) {
            if (Test-Path -LiteralPath $cfErr) {
                $txt = Get-Content -LiteralPath $cfErr -Raw -ErrorAction SilentlyContinue
                if ($txt -match 'https://[a-z0-9-]+\.trycloudflare\.com') {
                    $tunnelUrl = $Matches[0]
                    break
                }
            }
            Start-Sleep -Milliseconds 500
        }
        if ($tunnelUrl) {
            Set-Content -LiteralPath (Join-Path $RuntimeDir 'tunnel-url.txt') -Value $tunnelUrl -Encoding UTF8
            Write-Host ('[OK] Tunel URL: ' + $tunnelUrl) -ForegroundColor Green
            if ($env:AIOSTREAMS_BASE_URL -and $env:AIOSTREAMS_UUID -and $env:AIOSTREAMS_PASSWORD) {
                $aioScript = Join-Path $Root 'scripts\update-aio.js'
                & $nodeExe $aioScript $tunnelUrl
            }
        } else {
            Write-Warning 'cloudflared tunel URL 20 saniye icinde alinamadi.'
        }
    } else {
        Write-Warning 'ENABLE_TUNNEL=1 ancak cloudflared bulunamadi (winget install Cloudflare.cloudflared).'
    }
}

# 5. PID dosyasini kaydet
$procArray = @()
foreach ($t in $tracked) {
    $procArray += [ordered]@{
        name = [string]$t.name
        port = [int]$t.port
        pid = [int]$t.pid
        startedAt = [string]$t.startedAt
    }
}
$stateObj = [ordered]@{
    repoRoot = [string]$Root
    updatedAt = (Get-Date).ToString('o')
    processes = $procArray
}
($stateObj | ConvertTo-Json -Depth 4) | Set-Content -LiteralPath $PidFile -Encoding UTF8

Write-Host ''
Write-Host '=== Servis Durumu ===' -ForegroundColor Cyan
$rows = @(
    [PSCustomObject]@{ Servis = 'cs-host';        Port = $bbP;     Durum = $(if ($csOk) { 'HAZIR' } else { 'BEKLIYOR' }) },
    [PSCustomObject]@{ Servis = 'egress';         Port = $egressP; Durum = $(if ($egOk) { 'HAZIR' } else { 'BEKLIYOR' }) },
    [PSCustomObject]@{ Servis = 'kraptor-bridge'; Port = $bridgeP; Durum = $(if ($brOk) { 'HAZIR' } else { 'BEKLIYOR' }) },
    [PSCustomObject]@{ Servis = 'trhub';          Port = $hubP;    Durum = $(if ($hubOk) { 'HAZIR' } else { 'BEKLIYOR' }) },
    [PSCustomObject]@{ Servis = 'mega-bridge';    Port = $megaP;   Durum = $(if ($megaOk) { 'HAZIR' } else { 'BEKLIYOR' }) }
)
$rows | Format-Table -AutoSize | Out-String | Write-Host
Write-Host 'Nuvio Desktop Linkleri:' -ForegroundColor Green
Write-Host ('  Lanettirr Repo : http://127.0.0.1:' + $megaP + '/saved/nuvio-repo/manifest.json')
Write-Host ('  Ayar Paneli    : http://127.0.0.1:' + $megaP + '/configure')
Write-Host ('  Fusion Rozet   : http://127.0.0.1:' + $megaP + '/badges.json')
Write-Host ('  Stremio / AIO  : http://127.0.0.1:' + $megaP + '/saved/manifest.json')
Write-Host ('  Ham TR Hub     : http://127.0.0.1:' + $hubP + '/nuvio-repo/manifest.json')
Write-Host ('  Ham EN Hub     : http://127.0.0.1:' + $hubP + '/en-repo/manifest.json')

