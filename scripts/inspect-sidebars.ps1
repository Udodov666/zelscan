
$files = @(
    "C:\Users\domas\claude222\zelscass\landing\zelscan_dashboard_static_test.html",
    "C:\Users\domas\claude222\zelscass\landing\zelscan_dashboard.html"
)

foreach ($filePath in $files) {
    $fileName = Split-Path $filePath -Leaf
    Write-Host ""
    Write-Host "========================================"
    Write-Host "=== FILE: $fileName ==="
    Write-Host "========================================"

    # Read as UTF-8 bytes then convert to string
    $bytes = [System.IO.File]::ReadAllBytes($filePath)
    $raw = [System.Text.Encoding]::UTF8.GetString($bytes)

    # Strip base64 data
    $stripped = $raw -replace 'base64,[A-Za-z0-9+/=]+', 'base64,__IMG__'

    # Split into lines
    $lines = $stripped -split "`n"

    # --- First 5 lines ---
    Write-Host ""
    Write-Host "--- FIRST 5 LINES ---"
    for ($i = 0; $i -lt [Math]::Min(5, $lines.Count); $i++) {
        $lineNum = $i + 1
        Write-Host ("{0,6}: {1}" -f $lineNum, $lines[$i].TrimEnd())
    }

    # --- Lines containing "sidebar" ---
    Write-Host ""
    Write-Host "--- LINES CONTAINING 'sidebar' (case-insensitive) ---"
    $found = $false
    for ($i = 0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -imatch 'sidebar') {
            $lineNum = $i + 1
            Write-Host ("{0,6}: {1}" -f $lineNum, $lines[$i].TrimEnd())
            $found = $true
        }
    }
    if (-not $found) { Write-Host "  (none found)" }

    # --- Complete <aside> block ---
    Write-Host ""
    Write-Host "--- COMPLETE <aside> BLOCK ---"

    $insideAside = $false
    $depth = 0
    $asideFound = $false

    for ($i = 0; $i -lt $lines.Count; $i++) {
        $line = $lines[$i]
        $lineNum = $i + 1

        if (-not $insideAside) {
            # Look for opening <aside (with optional attributes)
            if ($line -imatch '<aside[\s>]') {
                $insideAside = $true
                $asideFound = $true
                # Count opening tags on this line
                $opens = ([regex]::Matches($line, '(?i)<aside[\s>]')).Count
                $closes = ([regex]::Matches($line, '(?i)</aside>')).Count
                $depth = $opens - $closes
                Write-Host ("{0,6}: {1}" -f $lineNum, $line.TrimEnd())
                if ($depth -le 0) {
                    $insideAside = $false
                }
            }
        } else {
            $opens = ([regex]::Matches($line, '(?i)<aside[\s>]')).Count
            $closes = ([regex]::Matches($line, '(?i)</aside>')).Count
            $depth = $depth + $opens - $closes
            Write-Host ("{0,6}: {1}" -f $lineNum, $line.TrimEnd())
            if ($depth -le 0) {
                $insideAside = $false
            }
        }
    }

    if (-not $asideFound) {
        Write-Host "  (no <aside> block found)"
    }
}

Write-Host ""
Write-Host "=== DONE ==="
