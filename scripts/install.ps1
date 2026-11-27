param(
    [string]$DepsZip = '',
    [string]$DepsUrl = 'https://github.com/0mamiis/lanettirr/releases/latest/download/cs-host-deps.zip',
    [switch]$SkipWinget,
    [switch]$SkipHashCheck,
    [switch]$AutoStart,
    [switch]$NoPrompt
)

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
} catch {
}

$ExpectedSha256 = '260A9EE198FDDA6A02853A6ADA1866C01887C44F5A346981E6C9321120477D7E'
$Root = Split-Path -Parent $PSScriptRoot

Write-Host '=== Lanettirr Nuvio Hub Kurulumu ===' -ForegroundColor Cyan
Write-Host ('Klasor: ' + $Root)

# 1. ZIP indirmesi sonrasi Mark-of-the-Web kilitlerini kaldir
try {
    Get-ChildItem -Path $Root -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue
} catch {
}

function Find-Jdk21Home {
    $roots = @(
        'C:\Program Files\Eclipse Adoptium',
        'C:\Program Files\Microsoft',
        'C:\Program Files\Java',
        'C:\Program Files\AdoptOpenJDK'
    )
    foreach ($r in $roots) {
        if (Test-Path -LiteralPath $r) {
            $dirs = Get-ChildItem -LiteralPath $r -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '^jdk-(2[1-9]|[3-9][0-9])' } | Sort-Object Name -Descending
            foreach ($d in $dirs) {
                $javaExe = Join-Path $d.FullName 'bin\java.exe'
                if (Test-Path -LiteralPath $javaExe) {
                    return $d.FullName
                }
            }
        }
    }
    return $null
}

function Refresh-EnvPath {
    $parts = New-Object System.Collections.Generic.List[string]
    foreach ($scope in @('Machine', 'User')) {
        $val = [Environment]::GetEnvironmentVariable('Path', $scope)
        if (-not [string]::IsNullOrWhiteSpace($val)) {
            foreach ($p in ($val -split ';')) {
                if (-not [string]::IsNullOrWhiteSpace($p)) {
                    $parts.Add($p.Trim())
                }
            }
        }
    }

    $extra = @(
        'C:\Program Files\nodejs',
        (Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links')
    )
    $jdkHome = Find-Jdk21Home
    if ($jdkHome) {
        $env:JAVA_HOME = $jdkHome
        $extra += (Join-Path $jdkHome 'bin')
    } else {
        $sysJava = [Environment]::GetEnvironmentVariable('JAVA_HOME', 'Machine')
        if (-not $sysJava) {
            $sysJava = [Environment]::GetEnvironmentVariable('JAVA_HOME', 'User')
        }
        if ($sysJava -and (Test-Path -LiteralPath (Join-Path $sysJava 'bin\java.exe'))) {
            $env:JAVA_HOME = $sysJava
            $extra += (Join-Path $sysJava 'bin')
        }
    }

    foreach ($e in $extra) {
        if ($e -and (Test-Path -LiteralPath $e)) {
            $parts.Add($e)
        }
    }

    $seen = @{
    }
    $unique = New-Object System.Collections.Generic.List[string]
    foreach ($p in $parts) {
        $key = $p.TrimEnd('\').ToLowerInvariant()
        if ($key -and (-not $seen.ContainsKey($key))) {
            $seen[$key] = $true
            $unique.Add($p)
        }
    }
    $env:Path = ($unique -join ';')
}

function Test-NodeReady {
    $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if (-not $cmd) { return $false }
    try {
        $v = (& $cmd.Source -v 2>$null).Trim()
        if ($v -match '^v(\d+)') {
            return ([int]$Matches[1] -ge 18)
        }
    } catch {
    }
    return $false
}

function Test-Java21Ready {
    $candidates = New-Object System.Collections.Generic.List[string]
    if ($env:JAVA_HOME) {
        $candidates.Add((Join-Path $env:JAVA_HOME 'bin\java.exe'))
    }
    $cmd = Get-Command java.exe -ErrorAction SilentlyContinue
    if ($cmd) { $candidates.Add($cmd.Source) }
    $jdk = Find-Jdk21Home
    if ($jdk) { $candidates.Add((Join-Path $jdk 'bin\java.exe')) }

    foreach ($exe in $candidates) {
        if ($exe -and (Test-Path -LiteralPath $exe)) {
            $prevEap = $ErrorActionPreference
            try {
                $ErrorActionPreference = 'Continue'
                $out = (& $exe -version 2>&1) -join ' '
                if ($out -match 'version "(\d+)') {
                    if ([int]$Matches[1] -ge 21) {
                        return $true
                    }
                }
            } catch {
            } finally {
                $ErrorActionPreference = $prevEap
            }
        }
    }
    return $false
}

function Test-FfmpegReady {
    if (Get-Command ffmpeg.exe -ErrorAction SilentlyContinue) { return $true }
    $link = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Links\ffmpeg.exe'
    if (Test-Path -LiteralPath $link) { return $true }
    $pkgRoot = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
    if (Test-Path -LiteralPath $pkgRoot) {
        $found = Get-ChildItem -Path $pkgRoot -Filter 'ffmpeg.exe' -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
        if ($found) { return $true }
    }
    return $false
}

function Install-WithWinget {
    param([string]$PackageId, [string]$Label)
    $wg = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $wg) {
        throw ($Label + ' is missing and winget was not found. Please install it manually and re-run install.bat.')
    }
    Write-Host ('[winget] ' + $Label + ' kuruluyor (' + $PackageId + ')...') -ForegroundColor Yellow
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $wg.Source install --id $PackageId -e --accept-package-agreements --accept-source-agreements --silent --disable-interactivity
        $code = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $prevEap
    }
    # 0 = kuruldu, -1978335189 / -1978335135 = zaten kurulu / guncelleme yok
    if (($code -ne 0) -and ($code -ne -1978335189) -and ($code -ne -1978335135)) {
        Write-Warning ('winget cikis kodu ' + $code + ' (' + $PackageId + '). Arac kontrol ediliyor...')
    }
    Refresh-EnvPath
}

function Install-NpmDir {
    param([string]$DirPath, [string]$Label)
    Write-Host ('[npm] ' + $Label + ' paketleri kuruluyor...') -ForegroundColor Cyan
    $npmCmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if (-not $npmCmd) {
        $npmCmd = Get-Command npm -ErrorAction SilentlyContinue
    }
    if (-not $npmCmd) {
        throw 'npm not found. After installing Node.js, open a new window and run install.bat.'
    }
    $lockFile = Join-Path $DirPath 'package-lock.json'
    Push-Location -LiteralPath $DirPath
    $prevEap = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        if (Test-Path -LiteralPath $lockFile) {
            & $npmCmd.Source ci --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) {
                Write-Warning ('npm ci basarisiz oldu (' + $Label + '), npm install ile deneniyor...')
                & $npmCmd.Source install --no-audit --no-fund
                if ($LASTEXITCODE -ne 0) {
                    throw ('npm install basarisiz: ' + $Label)
                }
            }
        } else {
            & $npmCmd.Source install --no-audit --no-fund
            if ($LASTEXITCODE -ne 0) {
                throw ('npm install basarisiz: ' + $Label)
            }
        }
    } finally {
        $ErrorActionPreference = $prevEap
        Pop-Location
    }
}

Refresh-EnvPath

# 2. Sistem araclari (Node.js 18+, Java 21+, FFmpeg)
if (-not (Test-NodeReady)) {
    if ($SkipWinget) { throw 'Node.js 18+ bulunamadi (-SkipWinget aktif).' }
    Install-WithWinget -PackageId 'OpenJS.NodeJS.LTS' -Label 'Node.js LTS'
    if (-not (Test-NodeReady)) { throw 'Node.js 18+ kurulumu dogrulanamadi.' }
} else {
    Write-Host '[OK] Node.js hazir.' -ForegroundColor Green
}

if (-not (Test-Java21Ready)) {
    if ($SkipWinget) { throw 'Java 21+ bulunamadi (-SkipWinget aktif).' }
    Install-WithWinget -PackageId 'EclipseAdoptium.Temurin.21.JDK' -Label 'Eclipse Temurin JDK 21'
    if (-not (Test-Java21Ready)) { throw 'Java 21+ kurulumu dogrulanamadi.' }
} else {
    Write-Host '[OK] Java 21+ hazir.' -ForegroundColor Green
}

if (-not (Test-FfmpegReady)) {
    if ($SkipWinget) { throw 'FFmpeg bulunamadi (-SkipWinget aktif).' }
    Install-WithWinget -PackageId 'Gyan.FFmpeg' -Label 'FFmpeg'
    if (-not (Test-FfmpegReady)) { throw 'FFmpeg kurulumu dogrulanamadi.' }
} else {
    Write-Host '[OK] FFmpeg hazir.' -ForegroundColor Green
}

# 3. Node paketleri
Install-NpmDir -DirPath (Join-Path $Root 'trhub') -Label 'trhub'
Install-NpmDir -DirPath (Join-Path $Root 'mega-bridge') -Label 'mega-bridge'

# 4. cs-host runtime bagimliliklari (cs-host-deps.zip)
$csAppJar = Join-Path $Root 'cs-host\lib\cs-app.jar'
$androidJar = Join-Path $Root 'cs-host\lib\android.jar'
$dexBat = Join-Path $Root 'cs-host\tools\dex-tools-v2.4\d2j-dex2jar.bat'
$depsReady = (Test-Path -LiteralPath $csAppJar) -and (Test-Path -LiteralPath $androidJar) -and (Test-Path -LiteralPath $dexBat)

if ((-not $depsReady) -or (-not [string]::IsNullOrWhiteSpace($DepsZip))) {
    $zipSource = ''
    $tempDownload = $false

    if (-not [string]::IsNullOrWhiteSpace($DepsZip)) {
        if (-not (Test-Path -LiteralPath $DepsZip)) {
            throw ('Belirtilen DepsZip dosyasi bulunamadi: ' + $DepsZip)
        }
        $zipSource = (Resolve-Path -LiteralPath $DepsZip).Path
    } else {
        $localCandidates = @(
            (Join-Path $Root 'cs-host-deps.zip'),
            (Join-Path (Split-Path -Parent $Root) 'lanettirr-release\cs-host-deps.zip')
        )
        foreach ($c in $localCandidates) {
            if (Test-Path -LiteralPath $c) {
                $zipSource = $c
                break
            }
        }
        if (-not $zipSource) {
            $zipSource = Join-Path $env:TEMP ('lanettirr-cs-host-deps-' + [Guid]::NewGuid().ToString('N') + '.zip')
            $tempDownload = $true
            Write-Host ('[indir] cs-host-deps.zip indiriliyor: ' + $DepsUrl) -ForegroundColor Cyan
            $curl = Get-Command curl.exe -ErrorAction SilentlyContinue
            if ($curl) {
                $prevEap = $ErrorActionPreference
                $ErrorActionPreference = 'Continue'
                try {
                    & $curl.Source -fL --retry 3 --retry-delay 2 -o $zipSource $DepsUrl
                    $curlCode = $LASTEXITCODE
                } finally {
                    $ErrorActionPreference = $prevEap
                }
                if ($curlCode -ne 0) {
                    Remove-Item -LiteralPath $zipSource -Force -ErrorAction SilentlyContinue
                    throw ('cs-host-deps.zip indirilemedi (curl cikis kodu: ' + $curlCode + ').')
                }
            } else {
                Invoke-WebRequest -UseBasicParsing -Uri $DepsUrl -OutFile $zipSource
            }
        }
    }

    try {
        if (-not $SkipHashCheck) {
            Write-Host '[dogrula] cs-host-deps.zip SHA-256 kontrol ediliyor...' -ForegroundColor Cyan
            $actualHash = (Get-FileHash -LiteralPath $zipSource -Algorithm SHA256).Hash.ToUpperInvariant()
            if ($actualHash -ne $ExpectedSha256) {
                throw ('SHA-256 uyusmadi! Beklenen: ' + $ExpectedSha256 + ' | Bulunan: ' + $actualHash)
            }
            Write-Host '[OK] SHA-256 dogrulandi.' -ForegroundColor Green
        }

        Write-Host '[ac] cs-host-deps.zip cikartiliyor...' -ForegroundColor Cyan
        Expand-Archive -LiteralPath $zipSource -DestinationPath $Root -Force
        try {
            Get-ChildItem -Path (Join-Path $Root 'cs-host') -Recurse -File -ErrorAction SilentlyContinue | Unblock-File -ErrorAction SilentlyContinue
        } catch {
        }
    } finally {
        if ($tempDownload -and (Test-Path -LiteralPath $zipSource)) {
            Remove-Item -LiteralPath $zipSource -Force -ErrorAction SilentlyContinue
        }
    }
} else {
    Write-Host '[OK] cs-host bagimliliklari zaten kurulu.' -ForegroundColor Green
}

# 5. Dosya butunluk kontrolu
foreach ($req in @($csAppJar, $androidJar, $dexBat)) {
    if (-not (Test-Path -LiteralPath $req)) {
        throw ('Eksik runtime dosyasi: ' + $req)
    }
}

# 6. Opsiyonel Windows otomatik baslatma kisayolu
$makeShortcut = $false
if ($AutoStart) {
    $makeShortcut = $true
} elseif (-not $NoPrompt) {
    $ans = Read-Host 'Windows acilisinda otomatik baslatilsin mi? (E/h)'
    if ([string]::IsNullOrWhiteSpace($ans) -or ($ans.Trim().ToUpperInvariant().StartsWith('E')) -or ($ans.Trim().ToUpperInvariant().StartsWith('Y'))) {
        $makeShortcut = $true
    }
}

if ($makeShortcut) {
    $startupDir = Join-Path $env:APPDATA 'Microsoft\Windows\Start Menu\Programs\Startup'
    $lnkPath = Join-Path $startupDir 'Lanettirr-Nuvio.lnk'
    $vbsPath = Join-Path $Root 'scripts\start-hidden.vbs'
    $wsh = New-Object -ComObject WScript.Shell
    $sc = $wsh.CreateShortcut($lnkPath)
    $sc.TargetPath = (Join-Path $env:WINDIR 'System32\wscript.exe')
    $sc.Arguments = '"' + $vbsPath + '"'
    $sc.WorkingDirectory = $Root
    $sc.Description = 'Lanettirr Nuvio Hub Otomatik Baslatici'
    $sc.Save()
    Write-Host ('[OK] Otomatik baslatma kisayolu olusturuldu: ' + $lnkPath) -ForegroundColor Green
}

Write-Host ''
Write-Host '=== Kurulum Tamamlandi! ===' -ForegroundColor Green
Write-Host 'Now run start.bat and open the config panel in your browser:'
Write-Host '  Ayar Paneli    : http://127.0.0.1:17410/configure'
Write-Host '  Nuvio Repo     : http://127.0.0.1:17410/saved/nuvio-repo/manifest.json'
Write-Host '  CloudStream 3  : http://127.0.0.1:17410/saved/cs3/repo.json'
Write-Host '  Fusion Rozet   : http://127.0.0.1:17410/badges.json'
Write-Host '  Stremio        : http://127.0.0.1:17410/saved/manifest.json'
Write-Host 'Not: Nuvio eklenti ayarlarinda "Eklenti saglayicilarini depoya gore grupla" secenegini acin.'

