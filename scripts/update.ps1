param(
    [string]$Repo = '0mamiis/lanettirr',
    [string]$Branch = 'main',
    [string]$StatusFile = '',
    [string]$TargetVersion = '',
    [switch]$FromUi,
    [switch]$NoRestart,
    [switch]$SkipNpm
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

$Root = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $Root '.runtime'
New-Item -ItemType Directory -Path $RuntimeDir -Force | Out-Null
if ([string]::IsNullOrWhiteSpace($StatusFile)) {
    $StatusFile = Join-Path $RuntimeDir 'update-status.json'
} else {
    $statusParent = Split-Path -Parent $StatusFile
    if ($statusParent) { New-Item -ItemType Directory -Path $statusParent -Force | Out-Null }
}

function Read-LocalVersion {
    foreach ($p in @((Join-Path $Root 'VERSION'), (Join-Path $Root 'mega-bridge\VERSION'))) {
        if (Test-Path -LiteralPath $p) {
            $v = (Get-Content -LiteralPath $p -Raw -Encoding UTF8 -ErrorAction SilentlyContinue)
            if ($v) { return ($v.Trim() -replace '^v', '') }
        }
    }
    return '0.0.0'
}

$script:StartedAt = (Get-Date).ToString("o")
$script:CurrentVersion = Read-LocalVersion
$script:LastPercent = 5
if ([string]::IsNullOrWhiteSpace($TargetVersion)) { $script:TargetVer = $script:CurrentVersion } else { $script:TargetVer = ($TargetVersion.Trim() -replace "^v", "") }

function Write-UpdateStatus {
    param(
        [bool]$Running,
        [string]$Stage,
        [int]$Percent,
        [string]$Message,
        [bool]$Done = $false,
        [string]$ErrorText = ''
    )
    $script:LastPercent = $Percent
    $obj = [ordered]@{
        running = $Running
        stage = $Stage
        percent = $Percent
        message = $Message
        done = $Done
        error = $(if ([string]::IsNullOrWhiteSpace($ErrorText)) { $null } else { $ErrorText })
        currentVersion = $script:CurrentVersion
        targetVersion = $script:TargetVer
        startedAt = $script:StartedAt
        updatedAt = (Get-Date).ToString("o")
    }
    $jsonText = $obj | ConvertTo-Json -Depth 4
    $tmp = $StatusFile + ".tmp." + $PID
    $utf8NoBom = New-Object System.Text.UTF8Encoding($false)
    [System.IO.File]::WriteAllText($tmp, $jsonText, $utf8NoBom)
    Move-Item -LiteralPath $tmp -Destination $StatusFile -Force
}

function Say {
    param([string]$Msg, [string]$Color = "Cyan")
    if (-not $FromUi) { Write-Host $Msg -ForegroundColor $Color }
}

function Get-FileSha256Safe {
    param([string]$Path)
    if (-not (Test-Path -LiteralPath $Path)) { return "" }
    try { return (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash } catch { return "" }
}

function Test-IsProtectedRelativePath {
    param([string]$RelPath)
    $norm = ($RelPath -replace "\\", "/").TrimStart("/")
    $exact = @(
        '.env',
        'cloudflared.exe',
        'mega-bridge/saved-config.json',
        'mega-bridge/blacklist.json',
        'trhub/speed.json',
        'trhub/provstat.json'
    )
    foreach ($e in $exact) { if ($norm -ieq $e) { return $true } }
    $prefixes = @(
        '.git/',
        '.runtime/',
        'node_modules/',
        'trhub/node_modules/',
        'trhub/tl/',
        'mega-bridge/node_modules/',
        'kraptor-bridge/cache/',
        'kraptor-bridge/tx/',
        'cs-host/cache/',
        'cs-host/lib/',
        'cs-host/tools/'
    )
    foreach ($p in $prefixes) { if ($norm.StartsWith($p, [System.StringComparison]::OrdinalIgnoreCase)) { return $true } }
    if ($norm -ieq ".git" -or $norm -ieq ".runtime" -or $norm -ieq "node_modules") { return $true }
    return $false
}

function Install-NpmDir {
    param([string]$DirPath, [string]$Label)
    $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npmCmd) { $npmCmd = Get-Command npm -ErrorAction SilentlyContinue }
    if (-not $npmCmd) { throw "npm bulunamadi." }
    $lockFile = Join-Path $DirPath "package-lock.json"
    Push-Location -LiteralPath $DirPath
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = "Continue"
    try {
        if (Test-Path -LiteralPath $lockFile) {
            & $npmCmd.Source ci --no-audit --no-fund 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) {
                & $npmCmd.Source install --no-audit --no-fund 2>&1 | Out-Null
                if ($LASTEXITCODE -ne 0) { throw ("npm install basarisiz: " + $Label) }
            }
        } else {
            & $npmCmd.Source install --no-audit --no-fund 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) { throw ("npm install basarisiz: " + $Label) }
        }
    } finally {
        $ErrorActionPreference = $prevEap
        Pop-Location
    }
}

function Resolve-MegaPort {
    $envFile = Join-Path $Root ".env"
    $fallback = 0
    if (Test-Path -LiteralPath $envFile) {
        foreach ($rawLine in (Get-Content -LiteralPath $envFile -Encoding UTF8 -ErrorAction SilentlyContinue)) {
            $line = $rawLine.Trim()
            if ([string]::IsNullOrWhiteSpace($line) -or $line.StartsWith("#")) { continue }
            if ($line -match '^MEGA_PORT\s*=\s*["'']?(\d+)["'']?(?:\s*(?:#.*)?$)') {
                return [int]$Matches[1]
            }
            if ($line -match '^PORT\s*=\s*["'']?(\d+)["'']?(?:\s*(?:#.*)?$)') {
                $fallback = [int]$Matches[1]
            }
        }
    }
    if ($fallback -gt 0) { return $fallback }
    return 17410
}

$tempWork = Join-Path $env:TEMP ("lanettirr-upd-" + [Guid]::NewGuid().ToString("N"))
$backupDir = Join-Path $tempWork "backup"
$preserveFiles = @(".env", "mega-bridge\saved-config.json", "mega-bridge\blacklist.json")

try {
    Say "=== Lanettirr Guncelleyici ===" "Cyan"
    Write-UpdateStatus -Running $true -Stage "starting" -Percent 5 -Message "Starting update..."

    try {
        $verUrl = "https://raw.githubusercontent.com/" + $Repo + "/" + $Branch + "/VERSION"
        $rv = (Invoke-WebRequest -UseBasicParsing -Uri $verUrl -TimeoutSec 10).Content
        if ($rv) { $script:TargetVer = ($rv.Trim() -replace "^v", "") }
    } catch {}

    Say "[1/5] Ayarlar yedekleniyor..." "Cyan"
    Write-UpdateStatus -Running $true -Stage "backup" -Percent 15 -Message "Backing up user settings..."
    New-Item -ItemType Directory -Path $backupDir -Force | Out-Null
    foreach ($rel in $preserveFiles) {
        $src = Join-Path $Root $rel
        if (Test-Path -LiteralPath $src) {
            $dst = Join-Path $backupDir $rel
            $dstDir = Split-Path -Parent $dst
            if ($dstDir) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
            Copy-Item -LiteralPath $src -Destination $dst -Force
        }
    }

    $trPkgBefore = Get-FileSha256Safe (Join-Path $Root "trhub\package.json")
    $trLockBefore = Get-FileSha256Safe (Join-Path $Root "trhub\package-lock.json")
    $mbPkgBefore = Get-FileSha256Safe (Join-Path $Root "mega-bridge\package.json")
    $mbLockBefore = Get-FileSha256Safe (Join-Path $Root "mega-bridge\package-lock.json")

    $gitDir = Join-Path $Root ".git"
    $gitCmd = Get-Command git.exe -ErrorAction SilentlyContinue
    $useGit = (Test-Path -LiteralPath $gitDir) -and ($null -ne $gitCmd)

    if ($useGit) {
        Say "[2/5] Git uzerinden son surum cekiliyor..." "Cyan"
        Write-UpdateStatus -Running $true -Stage "download" -Percent 35 -Message "Fetching latest version via Git..."
        $prevEap = $ErrorActionPreference
        $ErrorActionPreference = "Continue"
        try {
            & $gitCmd.Source -C $Root fetch origin $Branch --depth 1 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "git fetch basarisiz oldu." }
            Write-UpdateStatus -Running $true -Stage "extract" -Percent 55 -Message "Applying updated files..."
            & $gitCmd.Source -C $Root reset --hard ("origin/" + $Branch) 2>&1 | Out-Null
            if ($LASTEXITCODE -ne 0) { throw "git reset basarisiz oldu." }
        } finally {
            $ErrorActionPreference = $prevEap
        }
    } else {
        $zipUrl = "https://github.com/" + $Repo + "/archive/refs/heads/" + $Branch + ".zip"
        $zipPath = Join-Path $tempWork "repo.zip"
        $extractDir = Join-Path $tempWork "extract"
        Say ("[2/5] Son surum indiriliyor: " + $zipUrl) "Cyan"
        Write-UpdateStatus -Running $true -Stage "download" -Percent 35 -Message "Downloading latest package..."
        $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
        if ($curl) {
            $prevEap = $ErrorActionPreference
            $ErrorActionPreference = "Continue"
            try {
                & $curl.Source -fsSL --retry 3 --retry-delay 2 -o $zipPath $zipUrl
                $cCode = $LASTEXITCODE
            } finally {
                $ErrorActionPreference = $prevEap
            }
            if ($cCode -ne 0) { throw ("Indirme basarisiz (curl cikis kodu: " + $cCode + ")") }
        } else {
            Invoke-WebRequest -UseBasicParsing -Uri $zipUrl -OutFile $zipPath -TimeoutSec 60
        }

        Say "[3/5] Dosyalar cikariliyor ve uygulaniyor..." "Cyan"
        Write-UpdateStatus -Running $true -Stage "extract" -Percent 55 -Message "Extracting and applying files..."
        Expand-Archive -LiteralPath $zipPath -DestinationPath $extractDir -Force
        $srcRoot = Get-ChildItem -LiteralPath $extractDir -Directory | Select-Object -First 1
        if (-not $srcRoot) { throw "Indirilen arsiv bos veya gecersiz." }

        $srcPrefix = $srcRoot.FullName.TrimEnd("\") + "\"
        $oldExe = Join-Path $Root "Lanettirr.exe.old"
        if (Test-Path -LiteralPath $oldExe) { Remove-Item -LiteralPath $oldExe -Force -ErrorAction SilentlyContinue }
        $files = Get-ChildItem -LiteralPath $srcRoot.FullName -Recurse -File
        foreach ($f in $files) {
            $rel = $f.FullName.Substring($srcPrefix.Length)
            if (Test-IsProtectedRelativePath $rel) { continue }
            $dest = Join-Path $Root $rel
            $destDir = Split-Path -Parent $dest
            if ($destDir -and (-not (Test-Path -LiteralPath $destDir))) {
                New-Item -ItemType Directory -Path $destDir -Force | Out-Null
            }
            if (($rel -ieq "Lanettirr.exe") -and (Test-Path -LiteralPath $dest)) {
                try { Move-Item -LiteralPath $dest -Destination $oldExe -Force } catch {}
            }
            Copy-Item -LiteralPath $f.FullName -Destination $dest -Force
        }
        try { Get-ChildItem -Path $Root -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue } catch {}
    }

    foreach ($rel in $preserveFiles) {
        $bak = Join-Path $backupDir $rel
        $dst = Join-Path $Root $rel
        if ((Test-Path -LiteralPath $bak) -and (-not (Test-Path -LiteralPath $dst))) {
            $dstDir = Split-Path -Parent $dst
            if ($dstDir) { New-Item -ItemType Directory -Path $dstDir -Force | Out-Null }
            Copy-Item -LiteralPath $bak -Destination $dst -Force
        }
    }

    Write-UpdateStatus -Running $true -Stage "install" -Percent 75 -Message "Checking dependencies..."
    $stoppedForUpdate = $false
    if (-not $SkipNpm) {
        $trChanged = (-not (Test-Path -LiteralPath (Join-Path $Root "trhub\node_modules"))) -or ($trPkgBefore -ne (Get-FileSha256Safe (Join-Path $Root "trhub\package.json"))) -or ($trLockBefore -ne (Get-FileSha256Safe (Join-Path $Root "trhub\package-lock.json")))
        $mbChanged = (-not (Test-Path -LiteralPath (Join-Path $Root "mega-bridge\node_modules"))) -or ($mbPkgBefore -ne (Get-FileSha256Safe (Join-Path $Root "mega-bridge\package.json"))) -or ($mbLockBefore -ne (Get-FileSha256Safe (Join-Path $Root "mega-bridge\package-lock.json")))
        if ((-not $NoRestart) -and ($trChanged -or $mbChanged)) {
            $stopPre = Join-Path $Root "scripts\stop-all.ps1"
            if (Test-Path -LiteralPath $stopPre) {
                if ($FromUi) { Start-Sleep -Milliseconds 500 }
                try { & $stopPre | Out-Null } catch {}
                Start-Sleep -Milliseconds 800
                $stoppedForUpdate = $true
            }
        }
        if ($trChanged -and (Test-Path -LiteralPath (Join-Path $Root "trhub\package.json"))) {
            Say "[4/5] trhub paketleri guncelleniyor..." "Cyan"
            Install-NpmDir -DirPath (Join-Path $Root "trhub") -Label "trhub"
        }
        if ($mbChanged -and (Test-Path -LiteralPath (Join-Path $Root "mega-bridge\package.json"))) {
            Say "[4/5] mega-bridge paketleri guncelleniyor..." "Cyan"
            Install-NpmDir -DirPath (Join-Path $Root "mega-bridge") -Label "mega-bridge"
        }
    }

    $newVer = Read-LocalVersion
    $script:CurrentVersion = $newVer
    if ($newVer -ne "0.0.0") { $script:TargetVer = $newVer }
    if (-not $NoRestart) {
        Say "[5/5] Servisler yeniden baslatiliyor..." "Cyan"
        Write-UpdateStatus -Running $true -Stage "restart" -Percent 90 -Message "Restarting services..."
        $stopScript = Join-Path $Root "scripts\stop-all.ps1"
        $startScript = Join-Path $Root "scripts\start-all.ps1"
        if ((-not $stoppedForUpdate) -and (Test-Path -LiteralPath $stopScript)) {
            if ($FromUi) { Start-Sleep -Milliseconds 500 }
            try { & $stopScript | Out-Null } catch {}
            Start-Sleep -Milliseconds 800
        }
        if (Test-Path -LiteralPath $startScript) {
            if ($FromUi) {
                Remove-Item Env:PORT -ErrorAction SilentlyContinue
                Remove-Item Env:MEGA_PORT -ErrorAction SilentlyContinue
            }
            & $startScript | Out-Null
        }
        $megaPort = Resolve-MegaPort
        $deadline = (Get-Date).AddSeconds(25)
        while ((Get-Date) -lt $deadline) {
            try {
                $r = Invoke-WebRequest -UseBasicParsing -Uri ("http://127.0.0.1:" + $megaPort + "/health") -TimeoutSec 3
                if ($r.StatusCode -eq 200) { break }
            } catch {}
            Start-Sleep -Milliseconds 500
        }
    }

    Write-UpdateStatus -Running $false -Stage "done" -Percent 100 -Message ("Updated to v" + $script:CurrentVersion) -Done $true
    Say ("[OK] Guncelleme tamamlandi! Aktif surum: v" + $script:CurrentVersion) "Green"
} catch {
    $errMsg = $_.Exception.Message
    try { Write-UpdateStatus -Running $false -Stage "error" -Percent $script:LastPercent -Message "Update failed" -Done $false -ErrorText $errMsg } catch {}
    if (-not $FromUi) { Write-Host ("[HATA] Guncelleme basarisiz: " + $errMsg) -ForegroundColor Red }
    exit 1
} finally {
    if (Test-Path -LiteralPath $tempWork) {
        Remove-Item -LiteralPath $tempWork -Recurse -Force -ErrorAction SilentlyContinue
    }
}
