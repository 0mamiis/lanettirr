$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$CsFile = Join-Path $PSScriptRoot 'LanettirrTray.cs'
$OutExe = Join-Path $Root 'Lanettirr.exe'
$PkgDir = Join-Path $Root '.runtime\webview2-pkg'

$coreDll = Join-Path $PkgDir 'lib\net462\Microsoft.Web.WebView2.Core.dll'
$wfDll = Join-Path $PkgDir 'lib\net462\Microsoft.Web.WebView2.WinForms.dll'
$loaderDll = Join-Path $PkgDir 'runtimes\win-x64\native\WebView2Loader.dll'

if (-not ((Test-Path -LiteralPath $coreDll) -and (Test-Path -LiteralPath $wfDll) -and (Test-Path -LiteralPath $loaderDll))) {
    Write-Host '[INFO] Microsoft.Web.WebView2 indiriliyor...' -ForegroundColor Cyan
    New-Item -ItemType Directory -Path $PkgDir -Force | Out-Null
    $zip = Join-Path $PkgDir 'webview2.nupkg.zip'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://www.nuget.org/api/v2/package/Microsoft.Web.WebView2' -OutFile $zip -TimeoutSec 30
    Expand-Archive -LiteralPath $zip -DestinationPath $PkgDir -Force
}

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $csc)) {
    throw 'csc.exe (.NET Framework 4 x64) bulunamadi.'
}

& $csc /nologo /optimize+ /platform:x64 /target:winexe /codepage:65001 /out:$OutExe `
    /r:System.dll /r:System.Drawing.dll /r:System.Windows.Forms.dll `
    ("/r:" + $coreDll) ("/r:" + $wfDll) `
    ("/resource:" + $coreDll + ",Microsoft.Web.WebView2.Core.dll") `
    ("/resource:" + $wfDll + ",Microsoft.Web.WebView2.WinForms.dll") `
    ("/resource:" + $loaderDll + ",WebView2Loader.dll") `
    $CsFile

if ($LASTEXITCODE -ne 0) {
    throw ('Lanettirr.exe derlenemedi (exit code: ' + $LASTEXITCODE + ')')
}

Write-Host ('[OK] Derlendi (Tek EXE + WebView2): ' + $OutExe) -ForegroundColor Green
