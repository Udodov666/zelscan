<#
    dump-sidebar.ps1  (READ-ONLY)

    Dumps the real sidebar source so it can be transplanted.
      1. Full contents of  landing/assets/js/sidebar-lab.html
      2. Lines 40-200 of   landing/assets/js/sidebar-lab.js
      3. Grep for "sidebar-lab.html" / "fetch(" / "SIDEBAR_HTML" in sidebar-lab.js

    "Strip base64" = if any line is a long base64 blob (data:...;base64,XXXX or a
    bare >=200-char base64 run), replace the blob with a [BASE64 STRIPPED: N chars]
    marker so the console output stays readable.

    This script only READS files. It never writes or modifies anything.
#>

$ErrorActionPreference = 'Stop'

$root       = 'C:\Users\domas\claude222\zelscass'
$sidebarHtml = Join-Path $root 'landing\assets\js\sidebar-lab.html'
$sidebarJs   = Join-Path $root 'landing\assets\js\sidebar-lab.js'

function Remove-Base64 {
    param([string]$Line)
    # Strip data URIs with base64 payloads
    $Line = [regex]::Replace(
        $Line,
        'data:[^;,\s]*;base64,[A-Za-z0-9+/=]+',
        { param($m) "[BASE64 STRIPPED: $($m.Value.Length) chars]" }
    )
    # Strip long bare base64 runs (>=200 chars)
    $Line = [regex]::Replace(
        $Line,
        '[A-Za-z0-9+/]{200,}={0,2}',
        { param($m) "[BASE64 STRIPPED: $($m.Value.Length) chars]" }
    )
    return $Line
}

function Write-Header {
    param([string]$Text)
    Write-Host ''
    Write-Host ('=' * 78)
    Write-Host $Text
    Write-Host ('=' * 78)
}

# ---------------------------------------------------------------------------
# 1. Full sidebar-lab.html
# ---------------------------------------------------------------------------
Write-Header "FILE 1 (FULL): $sidebarHtml"
$n = 0
Get-Content -LiteralPath $sidebarHtml | ForEach-Object {
    $n++
    $clean = Remove-Base64 $_
    '{0,5}: {1}' -f $n, $clean
}

# ---------------------------------------------------------------------------
# 2. sidebar-lab.js lines 40-200
# ---------------------------------------------------------------------------
Write-Header "FILE 2 (LINES 40-200): $sidebarJs"
$n = 0
Get-Content -LiteralPath $sidebarJs | ForEach-Object {
    $n++
    if ($n -ge 40 -and $n -le 200) {
        $clean = Remove-Base64 $_
        '{0,5}: {1}' -f $n, $clean
    }
}

# ---------------------------------------------------------------------------
# 3. Grep sidebar-lab.js for template/fetch references
# ---------------------------------------------------------------------------
Write-Header "FILE 3 (GREP in sidebar-lab.js): 'sidebar-lab.html' | 'fetch(' | 'SIDEBAR_HTML'"
$n = 0
Get-Content -LiteralPath $sidebarJs | ForEach-Object {
    $n++
    if ($_ -match 'sidebar-lab\.html' -or $_ -match 'fetch\(' -or $_ -match 'SIDEBAR_HTML') {
        $clean = Remove-Base64 $_
        '{0,5}: {1}' -f $n, $clean
    }
}

Write-Host ''
Write-Host 'Done (read-only).'
