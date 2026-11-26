param(
    [string]$CsAppJar = "",
    [string]$AndroidJar = "",
    [string]$KotlinStdlibJar = "",
    [string]$D8Bat = ""
)
$ErrorActionPreference = "Stop"
$PluginRoot = $PSScriptRoot
$RepoRoot = Split-Path -Parent $PluginRoot
$OutClasses = Join-Path $PluginRoot "build/classes"
$OutDexDir = Join-Path $RepoRoot "mega-bridge/cs3"

if (-not $CsAppJar) { $CsAppJar = Join-Path $RepoRoot "cs-host/lib/cs-app.jar" }
if (-not $AndroidJar) { $AndroidJar = Join-Path $RepoRoot "cs-host/lib/android.jar" }
if (-not $KotlinStdlibJar) { $KotlinStdlibJar = Join-Path $RepoRoot "cs-host/lib/kotlin-stdlib.jar" }
if (-not $D8Bat) {
    $cand = Get-Command d8.bat -ErrorAction SilentlyContinue
    if ($cand) { $D8Bat = $cand.Source }
}
foreach ($req in @($CsAppJar, $AndroidJar, $D8Bat)) {
    if (-not $req -or -not (Test-Path -LiteralPath $req)) { throw ("Missing build dependency: " + $req) }
}
if (Test-Path -LiteralPath $OutClasses) { Remove-Item -LiteralPath $OutClasses -Recurse -Force }
New-Item -ItemType Directory -Path $OutClasses -Force | Out-Null
New-Item -ItemType Directory -Path $OutDexDir -Force | Out-Null

$cpList = @($CsAppJar, $AndroidJar)
if ($KotlinStdlibJar -and (Test-Path -LiteralPath $KotlinStdlibJar)) { $cpList += $KotlinStdlibJar }
$cp = $cpList -join ";"
$sources = Get-ChildItem -Path (Join-Path $PluginRoot "src") -Filter "*.java" -Recurse | ForEach-Object { $_.FullName }
& javac --release 8 -encoding UTF-8 -cp $cp -d $OutClasses $sources
if ($LASTEXITCODE -ne 0) { throw "javac failed" }

$classFiles = Get-ChildItem -Path $OutClasses -Filter "*.class" -Recurse | ForEach-Object { $_.FullName }
& $D8Bat --release --min-api 21 --lib $AndroidJar --classpath $CsAppJar --output $OutDexDir $classFiles
if ($LASTEXITCODE -ne 0) { throw "d8 failed" }
Write-Host ("Built: " + (Join-Path $OutDexDir "classes.dex")) -ForegroundColor Green
