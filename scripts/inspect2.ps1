# inspect2.ps1 - Inspect HTML files for aside blocks, display:none rules, and sidebar rules

$file1 = "C:\Users\domas\claude222\zelscass\landing\zelscan_dashboard_static_test.html"
$file2 = "C:\Users\domas\claude222\zelscass\landing\zelscan_dashboard.html"

# Read files as UTF-8, stripping base64 data URIs to keep output manageable
function Read-FileStripBase64 {
    param([string]$path)
    $lines = [System.IO.File]::ReadAllLines($path, [System.Text.Encoding]::UTF8)
    $stripped = $lines | ForEach-Object {
        $_ -replace 'data:[a-zA-Z0-9+/.-]+;base64,[A-Za-z0-9+/=]{20,}', 'data:BASE64_STRIPPED'
    }
    return $stripped
}

Write-Host "=== Reading files ===" -ForegroundColor Cyan
$f1 = Read-FileStripBase64 $file1
$f2 = Read-FileStripBase64 $file2
Write-Host "File1 total lines: $($f1.Count)"
Write-Host "File2 total lines: $($f2.Count)"

Write-Host ""
Write-Host "============================================================" -ForegroundColor Yellow
Write-Host "TASK 1a: <aside> block from FILE1 (lines 3870-3900)" -ForegroundColor Yellow
Write-Host "============================================================"
$start1 = 3870 - 1  # 0-indexed
$end1   = [Math]::Min(3900 - 1, $f1.Count - 1)
for ($i = $start1; $i -le $end1; $i++) {
    Write-Host ("{0,5}: {1}" -f ($i+1), $f1[$i])
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Yellow
Write-Host "TASK 1b: <aside> block from FILE2 (lines 100-130)" -ForegroundColor Yellow
Write-Host "============================================================"
$start2 = 100 - 1
$end2   = [Math]::Min(130 - 1, $f2.Count - 1)
for ($i = $start2; $i -le $end2; $i++) {
    Write-Host ("{0,5}: {1}" -f ($i+1), $f2[$i])
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Yellow
Write-Host "TASK 2: Lines 1-5 of FILE1 (top of file)" -ForegroundColor Yellow
Write-Host "============================================================"
for ($i = 0; $i -le [Math]::Min(4, $f1.Count - 1); $i++) {
    Write-Host ("{0,5}: {1}" -f ($i+1), $f1[$i])
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Yellow
Write-Host "TASK 3: All lines in FILE1 containing 'display:none' or 'display: none'" -ForegroundColor Yellow
Write-Host "============================================================"
$found3 = $false
for ($i = 0; $i -lt $f1.Count; $i++) {
    if ($f1[$i] -match 'display\s*:\s*none') {
        Write-Host ("{0,5}: {1}" -f ($i+1), $f1[$i])
        $found3 = $true
    }
}
if (-not $found3) { Write-Host "(none found)" }

Write-Host ""
Write-Host "============================================================" -ForegroundColor Yellow
Write-Host "TASK 4: Line containing '.sidebar:not' in FILE1 (with 2 lines context)" -ForegroundColor Yellow
Write-Host "============================================================"
$found4 = $false
for ($i = 0; $i -lt $f1.Count; $i++) {
    if ($f1[$i] -match '\.sidebar:not') {
        $ctxStart = [Math]::Max(0, $i - 2)
        $ctxEnd   = [Math]::Min($f1.Count - 1, $i + 2)
        for ($j = $ctxStart; $j -le $ctxEnd; $j++) {
            $marker = if ($j -eq $i) { ">>>" } else { "   " }
            Write-Host ("{0} {1,5}: {2}" -f $marker, ($j+1), $f1[$j])
        }
        $found4 = $true
        Write-Host "---"
    }
}
if (-not $found4) { Write-Host "(not found)" }

Write-Host ""
Write-Host "============================================================" -ForegroundColor Yellow
Write-Host "TASK 5: Lines 810-825 of FILE1" -ForegroundColor Yellow
Write-Host "============================================================"
$start5 = 810 - 1
$end5   = [Math]::Min(825 - 1, $f1.Count - 1)
for ($i = $start5; $i -le $end5; $i++) {
    Write-Host ("{0,5}: {1}" -f ($i+1), $f1[$i])
}

Write-Host ""
Write-Host "=== inspect2.ps1 complete ===" -ForegroundColor Cyan
