# inspect3.ps1 - READ-ONLY sidebar design inspection
$ErrorActionPreference = 'Stop'

$dashboard  = 'C:\Users\domas\claude222\zelscass\landing\zelscan_dashboard.html'
$cssDir     = 'C:\Users\domas\claude222\zelscass\landing\assets\css'
$jsDir      = 'C:\Users\domas\claude222\zelscass\landing\assets\js'
$sidebarCss = 'C:\Users\domas\claude222\zelscass\landing\assets\css\sidebar-lab.css'
$sidebarJs  = 'C:\Users\domas\claude222\zelscass\landing\assets\js\sidebar-lab.js'

function Write-Header($t) {
    Write-Host ''
    Write-Host ('=' * 80)
    Write-Host $t
    Write-Host ('=' * 80)
}

# Strip base64: remove base64 data URIs so they don't flood output
function Strip-Base64([string]$line) {
    return ($line -replace 'data:[^;]+;base64,[A-Za-z0-9+/=]+', 'data:[...BASE64 STRIPPED...]')
}

# ---------------------------------------------------------------------------
Write-Header 'SECTION 1: zelscan_dashboard.html'
# ---------------------------------------------------------------------------
if (Test-Path $dashboard) {
    $lines = Get-Content -LiteralPath $dashboard
    $total = $lines.Count
    Write-Host "File: $dashboard"
    Write-Host "Total lines: $total"

    Write-Header '1a) <link rel="stylesheet"> tags'
    for ($i = 0; $i -lt $total; $i++) {
        if ($lines[$i] -match '<link[^>]*rel\s*=\s*["'']?stylesheet') {
            $n = $i + 1
            Write-Host ("{0,5}: {1}" -f $n, (Strip-Base64 $lines[$i]).Trim())
        }
    }

    Write-Header '1b) <script src=...> tags'
    for ($i = 0; $i -lt $total; $i++) {
        if ($lines[$i] -match '<script[^>]*\ssrc\s*=') {
            $n = $i + 1
            Write-Host ("{0,5}: {1}" -f $n, (Strip-Base64 $lines[$i]).Trim())
        }
    }

    Write-Header '1c) FULL first <style> block (inline)'
    $inStyle = $false
    for ($i = 0; $i -lt $total; $i++) {
        $l = $lines[$i]
        if (-not $inStyle -and $l -match '<style') { $inStyle = $true }
        if ($inStyle) {
            $n = $i + 1
            Write-Host ("{0,5}: {1}" -f $n, (Strip-Base64 $l))
            if ($l -match '</style>') { break }
        }
    }

    Write-Header '1d) LAST 30 lines of the file'
    $start = [Math]::Max(0, $total - 30)
    for ($i = $start; $i -lt $total; $i++) {
        $n = $i + 1
        Write-Host ("{0,5}: {1}" -f $n, (Strip-Base64 $lines[$i]))
    }
} else {
    Write-Host "NOT FOUND: $dashboard"
}

# ---------------------------------------------------------------------------
Write-Header 'SECTION 2: Files under assets\css and assets\js (with sizes)'
# ---------------------------------------------------------------------------
Write-Header '2a) CSS directory'
if (Test-Path $cssDir) {
    Get-ChildItem -LiteralPath $cssDir -File | Sort-Object Name |
        ForEach-Object { Write-Host ("{0,10} bytes  {1}" -f $_.Length, $_.Name) }
} else { Write-Host "NOT FOUND: $cssDir" }

Write-Header '2b) JS directory'
if (Test-Path $jsDir) {
    Get-ChildItem -LiteralPath $jsDir -File | Sort-Object Name |
        ForEach-Object { Write-Host ("{0,10} bytes  {1}" -f $_.Length, $_.Name) }
} else { Write-Host "NOT FOUND: $jsDir" }

# ---------------------------------------------------------------------------
Write-Header 'SECTION 3: sidebar-lab.css (ENTIRE FILE)'
# ---------------------------------------------------------------------------
if (Test-Path $sidebarCss) {
    $lines = Get-Content -LiteralPath $sidebarCss
    Write-Host "File: $sidebarCss"
    Write-Host "Total lines: $($lines.Count)"
    Write-Host ('-' * 80)
    for ($i = 0; $i -lt $lines.Count; $i++) {
        $n = $i + 1
        Write-Host ("{0,5}: {1}" -f $n, (Strip-Base64 $lines[$i]))
    }
} else { Write-Host "NOT FOUND: $sidebarCss" }

# ---------------------------------------------------------------------------
Write-Header 'SECTION 4: Search CSS for .sidebar / .sb-nav / .sb-item / .sb-user'
# ---------------------------------------------------------------------------
$selectors = @('\.sidebar', '\.sb-nav', '\.sb-item', '\.sb-user')
if (Test-Path $cssDir) {
    foreach ($sel in $selectors) {
        Write-Header ("4) Selector matches for: {0}" -f ($sel -replace '\\',''))
        $found = $false
        Get-ChildItem -LiteralPath $cssDir -File -Filter *.css | Sort-Object Name | ForEach-Object {
            $f = $_
            $cl = Get-Content -LiteralPath $f.FullName
            for ($i = 0; $i -lt $cl.Count; $i++) {
                if ($cl[$i] -match $sel) {
                    $found = $true
                    $n = $i + 1
                    Write-Host ("{0}:{1}: {2}" -f $f.Name, $n, (Strip-Base64 $cl[$i]).Trim())
                }
            }
        }
        if (-not $found) { Write-Host '(no matches)' }
    }
} else { Write-Host "NOT FOUND: $cssDir" }

# ---------------------------------------------------------------------------
Write-Header 'SECTION 5: sidebar-lab.js (first 60 lines)'
# ---------------------------------------------------------------------------
if (Test-Path $sidebarJs) {
    $lines = Get-Content -LiteralPath $sidebarJs
    Write-Host "File: $sidebarJs"
    Write-Host "Total lines: $($lines.Count)"
    Write-Host ('-' * 80)
    $max = [Math]::Min(60, $lines.Count)
    for ($i = 0; $i -lt $max; $i++) {
        $n = $i + 1
        Write-Host ("{0,5}: {1}" -f $n, (Strip-Base64 $lines[$i]))
    }
} else { Write-Host "NOT FOUND: $sidebarJs" }

Write-Host ''
Write-Host 'DONE (read-only inspection complete).'
