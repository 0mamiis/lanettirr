$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$PidFile = Join-Path $Root '.runtime\pids.json'

if (-not (Test-Path -LiteralPath $PidFile)) {
    Write-Host 'Calisan kayitli Lanettirr servisi bulunamadi (.runtime\pids.json yok).' -ForegroundColor Yellow
    exit 0
}

try {
    $data = Get-Content -LiteralPath $PidFile -Raw | ConvertFrom-Json
} catch {
    Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    Write-Warning 'pids.json okunamadi ve temizlendi.'
    exit 0
}

$stopped = 0
if ($data -and $data.processes) {
    foreach ($item in $data.processes) {
        if (-not $item.pid) { continue }
        $procId = [int]$item.pid
        $exists = Get-Process -Id $procId -ErrorAction SilentlyContinue
        if ($exists) {
            & taskkill.exe /PID $procId /T /F 2>$null | Out-Null
            Write-Host ('[DURDUR] ' + $item.name + ' (PID ' + $procId + ')') -ForegroundColor Cyan
            $stopped++
        }
    }
}

Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
Write-Host ('Toplam ' + $stopped + ' servis durduruldu.') -ForegroundColor Green

