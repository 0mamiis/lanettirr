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
$megaP = Resolve-Port -CliVal $MegaPort -EnvNames @('MEGA_PORT', 'PORT') -DefaultVal 17410

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
    $env:NU_CONC = '12'
}
if ([string]::IsNullOrWhiteSpace($env:TRHUB_PREFETCH)) { $env:TRHUB_PREFETCH = '0' }
if ([string]::IsNullOrWhiteSpace($env:TRHUB_SPEED_PROBE)) { $env:TRHUB_SPEED_PROBE = '0' }
if ([string]::IsNullOrWhiteSpace($env:EGRESS_CACHE_MB)) { $env:EGRESS_CACHE_MB = '64' }
if ([string]::IsNullOrWhiteSpace($env:MEGA_FFPROBE_CONC)) { $env:MEGA_FFPROBE_CONC = '3' }
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
    throw 'node.exe not found. Run install.bat first.'
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
$watchSpecs = New-Object System.Collections.Generic.List[object]
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
    $outLog = Join-Path $LogDir ($Name + '.out.log')
    $errLog = Join-Path $LogDir ($Name + '.err.log')

    if (($Port -gt 0) -and (Test-TcpPort -HostName '127.0.0.1' -Port $Port)) {
        $prevEntry = $tracked | Where-Object { $_.name -eq $Name } | Select-Object -First 1
        $prevPid = 0
        if ($prevEntry -and $prevEntry.pid) { $prevPid = [int]$prevEntry.pid }
        $watchSpecs.Add([PSCustomObject]@{
            name = $Name
            port = $Port
            pid = $prevPid
            filePath = $FilePath
            args = $ArgumentList
            workDir = $WorkingDirectory
            outLog = $outLog
            errLog = $errLog
        })
        Write-Host ('[ATLA] ' + $Name + ' zaten dinliyor (port ' + $Port + ')') -ForegroundColor DarkYellow
        return $null
    }

    $p = Start-Process -FilePath $FilePath -ArgumentList $ArgumentList -WorkingDirectory $WorkingDirectory -WindowStyle Hidden -RedirectStandardOutput $outLog -RedirectStandardError $errLog -PassThru
    $watchSpecs.Add([PSCustomObject]@{
        name = $Name
        port = $Port
        pid = $p.Id
        filePath = $FilePath
        args = $ArgumentList
        workDir = $WorkingDirectory
        outLog = $outLog
        errLog = $errLog
    })

    for ($i = $tracked.Count - 1; $i -ge 0; $i--) {
        if ($tracked[$i].name -eq $Name) { $tracked.RemoveAt($i) }
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

# 4. Opsiyonel Cloudflare Tunnel
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
        } else {
            Write-Warning 'cloudflared tunel URL 20 saniye icinde alinamadi.'
        }
    } else {
        Write-Warning 'ENABLE_TUNNEL=1 ancak cloudflared bulunamadi (winget install Cloudflare.cloudflared).'
    }
}

# 5. PID dosyasini kaydet
if ((-not $NoLoops) -and ($watchSpecs.Count -gt 0)) {
    $existingWd = $tracked | Where-Object { $_.name -eq 'watchdog' } | Select-Object -First 1
    if ($existingWd -and $existingWd.pid) {
        try { Stop-Process -Id ([int]$existingWd.pid) -Force -ErrorAction SilentlyContinue } catch {}
        $tracked.Remove($existingWd) | Out-Null
    }
    $specFile = Join-Path $RuntimeDir 'watchdog-specs.json'
    (ConvertTo-Json -InputObject ($watchSpecs.ToArray()) -Depth 4) | Set-Content -LiteralPath $specFile -Encoding UTF8
    $wdScript = Join-Path $RuntimeDir 'watchdog-all.ps1'
    $wdBody = @'
param([string]$SpecFile, [string]$PidFile)
$ErrorActionPreference = "Continue"
function Test-LocalPort([int]$p) {
    if ($p -le 0) { return $false }
    $c = New-Object System.Net.Sockets.TcpClient
    try { $ar = $c.BeginConnect("127.0.0.1", $p, $null, $null); if ($ar.AsyncWaitHandle.WaitOne(350, $false) -and $c.Connected) { $c.EndConnect($ar); return $true }; return $false } catch { return $false } finally { $c.Close() }
}
while ($true) {
    Start-Sleep -Seconds 8
    if (-not (Test-Path -LiteralPath $SpecFile)) { break }
    try { $specs = @(Get-Content -LiteralPath $SpecFile -Raw | ConvertFrom-Json) } catch { continue }
    $changed = $false
    foreach ($s in $specs) {
        $alive = $false
        if ($s.pid) { $alive = ($null -ne (Get-Process -Id ([int]$s.pid) -ErrorAction SilentlyContinue)) }
        if ((-not $alive) -and ($s.port -gt 0)) { $alive = Test-LocalPort ([int]$s.port) }
        if (-not $alive) {
            try {
                $np = Start-Process -FilePath $s.filePath -ArgumentList @($s.args) -WorkingDirectory $s.workDir -WindowStyle Hidden -RedirectStandardOutput $s.outLog -RedirectStandardError $s.errLog -PassThru
                if ($np) { $s.pid = $np.Id; $changed = $true }
            } catch {}
        }
    }
    if ($changed) {
        try { (ConvertTo-Json -InputObject @($specs) -Depth 4) | Set-Content -LiteralPath $SpecFile -Encoding UTF8 } catch {}
        try {
            if (Test-Path -LiteralPath $PidFile) {
                $pf = Get-Content -LiteralPath $PidFile -Raw | ConvertFrom-Json
                $plist = New-Object System.Collections.Generic.List[object]
                if ($pf.processes) { foreach ($pitem in @($pf.processes)) { $plist.Add($pitem) } }
                foreach ($s in $specs) {
                    $m = $plist | Where-Object { $_.name -eq $s.name } | Select-Object -First 1
                    if ($m) {
                        $m.pid = [int]$s.pid
                    } elseif ($s.pid) {
                        $plist.Add([PSCustomObject]@{ name = [string]$s.name; port = [int]$s.port; pid = [int]$s.pid; startedAt = (Get-Date).ToString("o") })
                    }
                }
                $pf.processes = @($plist)
                $pf.updatedAt = (Get-Date).ToString("o")
                ($pf | ConvertTo-Json -Depth 4) | Set-Content -LiteralPath $PidFile -Encoding UTF8
            }
        } catch {}
    }
}
'@
    Set-Content -LiteralPath $wdScript -Value $wdBody -Encoding UTF8
    $psExe = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $wdProc = Start-Process -FilePath $psExe -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-WindowStyle', 'Hidden', '-File', $wdScript, '-SpecFile', $specFile, '-PidFile', $PidFile) -WorkingDirectory $Root -WindowStyle Hidden -PassThru
    if ($wdProc) {
        $tracked.Insert(0, [PSCustomObject]@{ name = 'watchdog'; port = 0; pid = $wdProc.Id; startedAt = (Get-Date).ToString('o') })
    }
}
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
    [PSCustomObject]@{ Service = 'cs-host';        Port = $bbP;     Status = $(if ($csOk) { 'READY' } else { 'WAITING' }) },
    [PSCustomObject]@{ Service = 'egress';         Port = $egressP; Status = $(if ($egOk) { 'READY' } else { 'WAITING' }) },
    [PSCustomObject]@{ Service = 'kraptor-bridge'; Port = $bridgeP; Status = $(if ($brOk) { 'READY' } else { 'WAITING' }) },
    [PSCustomObject]@{ Service = 'trhub';          Port = $hubP;    Status = $(if ($hubOk) { 'READY' } else { 'WAITING' }) },
    [PSCustomObject]@{ Service = 'mega-bridge';    Port = $megaP;   Status = $(if ($megaOk) { 'READY' } else { 'WAITING' }) }
)
$rows | Format-Table -AutoSize | Out-String | Write-Host
Write-Host 'Nuvio Desktop Linkleri:' -ForegroundColor Green
Write-Host ('  Lanettirr Repo : http://127.0.0.1:' + $megaP + '/saved/nuvio-repo/manifest.json')
Write-Host ('  Ayar Paneli    : http://127.0.0.1:' + $megaP + '/configure')
Write-Host ('  CloudStream    : http://127.0.0.1:' + $megaP + '/saved/cs3/repo.json')
Write-Host ('  Fusion Rozet   : http://127.0.0.1:' + $megaP + '/badges.json')
Write-Host ('  Stremio        : http://127.0.0.1:' + $megaP + '/saved/manifest.json')
Write-Host ('  Ham TR Hub     : http://127.0.0.1:' + $hubP + '/nuvio-repo/manifest.json')
Write-Host ('  Ham EN Hub     : http://127.0.0.1:' + $hubP + '/en-repo/manifest.json')

