# fix-sidebar-css.ps1
# Removes the SidebarLab CSS block from zelscan_dashboard_static_test.html
# Also replaces the SidebarLab HTML (sb-variant-switcher) with the correct sb-user block from the original

$targetPath = "C:\Users\domas\claude222\zelscass\landing\zelscan_dashboard_static_test.html"
$sourcePath  = "C:\Users\domas\claude222\zelscass\landing\zelscan_dashboard.html"
$utf8        = [System.Text.Encoding]::UTF8

# ── 1. Read target as UTF-8 bytes then decode ──────────────────────────────────
$bytes   = [System.IO.File]::ReadAllBytes($targetPath)
$content = $utf8.GetString($bytes)
$beforeSize = $bytes.Length
Write-Host "Before size: $beforeSize bytes  ($($content.Length) chars)"

# ── 2. Remove ALL <style> blocks that contain "SIDEBAR LAB" ───────────────────
$removed = 0
$labMarker = "SIDEBAR LAB"

while ($true) {
    $labIndex = $content.IndexOf($labMarker)
    if ($labIndex -lt 0) { break }

    $styleOpen = $content.LastIndexOf("<style", $labIndex)
    if ($styleOpen -lt 0) {
        Write-Host "WARNING: no opening style before marker at $labIndex - skipping"
        break
    }

    $closeTag      = "</style>"
    $styleClose    = $content.IndexOf($closeTag, $labIndex)
    if ($styleClose -lt 0) {
        Write-Host "WARNING: no closing style after marker at $labIndex - skipping"
        break
    }
    $styleCloseEnd = $styleClose + $closeTag.Length

    $charsRemoved = $styleCloseEnd - $styleOpen
    Write-Host "Removing SidebarLab style block: chars $styleOpen to $styleCloseEnd ($charsRemoved chars)"
    $content = $content.Remove($styleOpen, $charsRemoved)
    $removed++
}

Write-Host "Total SidebarLab <style> blocks removed: $removed"

# ── 3. Replace sb-variant-switcher HTML with correct sb-user from source ──────
# The pasted content shows the static file has sb-variant-switcher instead of sb-user.
# The original dashboard has the correct sb-user block.
# We need to replace the sb-variant-switcher div with the correct sb-user div.

$switcherOpen  = '<div class="sb-variant-switcher"'
$switcherStart = $content.IndexOf($switcherOpen)

if ($switcherStart -ge 0) {
    Write-Host "Found sb-variant-switcher - replacing with sb-user"

    # Find the matching closing </div> by counting nesting
    $depth = 0
    $pos   = $switcherStart
    $switcherEnd = -1

    while ($pos -lt $content.Length) {
        $nextOpen  = $content.IndexOf("<div", $pos)
        $nextClose = $content.IndexOf("</div>", $pos)

        if ($nextClose -lt 0) { break }

        if ($nextOpen -ge 0 -and $nextOpen -lt $nextClose) {
            $depth++
            $pos = $nextOpen + 4
        } else {
            $depth--
            $pos = $nextClose + 6
            if ($depth -eq 0) {
                $switcherEnd = $pos
                break
            }
        }
    }

    if ($switcherEnd -gt 0) {
        $switcherLen = $switcherEnd - $switcherStart
        Write-Host "sb-variant-switcher block found"

        # Read the correct sb-user block from source
        $srcContent = [System.IO.File]::ReadAllText($sourcePath, $utf8)
        $sbUserOpen  = '<div class="sb-user"'
        $sbUserStart = $srcContent.IndexOf($sbUserOpen)

        if ($sbUserStart -ge 0) {
            # Find matching </div>
            $depth2 = 0
            $pos2   = $sbUserStart
            $sbUserEnd = -1

            while ($pos2 -lt $srcContent.Length) {
                $nextOpen2  = $srcContent.IndexOf("<div", $pos2)
                $nextClose2 = $srcContent.IndexOf("</div>", $pos2)

                if ($nextClose2 -lt 0) { break }

                if ($nextOpen2 -ge 0 -and $nextOpen2 -lt $nextClose2) {
                    $depth2++
                    $pos2 = $nextOpen2 + 4
                } else {
                    $depth2--
                    $pos2 = $nextClose2 + 6
                    if ($depth2 -eq 0) {
                        $sbUserEnd = $pos2
                        break
                    }
                }
            }

            if ($sbUserEnd -gt 0) {
                $sbUserBlock = $srcContent.Substring($sbUserStart, $sbUserEnd - $sbUserStart)
                Write-Host "Extracted sb-user block from source"
                $content = $content.Remove($switcherStart, $switcherLen).Insert($switcherStart, $sbUserBlock)
                Write-Host "Replaced sb-variant-switcher with sb-user"
            } else {
                Write-Host "WARNING: Could not find end of sb-user block in source"
            }
        } else {
            Write-Host "WARNING: sb-user not found in source file"
        }
    } else {
        Write-Host "WARNING: Could not find end of sb-variant-switcher block"
    }
} else {
    Write-Host "sb-variant-switcher not found in target (already correct or already removed)"
}

# ── 4. Check sidebar CSS presence ─────────────────────────────────────────────
$hasSidebarBase = $content -match '\.sidebar\s*\{'
$hasSbNav       = $content -match '\.sb-nav[\s\{]'
$hasSbItem      = $content -match '\.sb-item[\s\{]'
$hasSbUser      = $content -match '\.sb-user[\s\{]'

Write-Host ""
Write-Host "Sidebar CSS presence:"
Write-Host "  .sidebar  : $hasSidebarBase"
Write-Host "  .sb-nav   : $hasSbNav"
Write-Host "  .sb-item  : $hasSbItem"
Write-Host "  .sb-user  : $hasSbUser"

# ── 5. Write back UTF-8 without BOM ───────────────────────────────────────────
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($targetPath, $content, $utf8NoBom)

$afterBytes = [System.IO.File]::ReadAllBytes($targetPath)
$afterSize  = $afterBytes.Length
Write-Host ""
Write-Host "After size : $afterSize bytes"
Write-Host "Reduction  : $($beforeSize - $afterSize) bytes"

# ── 6. Verify ──────────────────────────────────────────────────────────────────
Write-Host ""
Write-Host "=== VERIFICATION ==="

$verContent = [System.IO.File]::ReadAllText($targetPath, $utf8)

function Count-Str($h, $n) {
    $c = 0; $i = 0
    while (($i = $h.IndexOf($n, $i)) -ge 0) { $c++; $i += $n.Length }
    return $c
}

$cntSidebarLab   = Count-Str $verContent "SIDEBAR LAB"
$cntSidebarLabH  = Count-Str $verContent "#sidebarLab"
$cntSidebarBase  = (Count-Str $verContent ".sidebar{") + (Count-Str $verContent ".sidebar {")
$cntSbItem       = (Count-Str $verContent ".sb-item{") + (Count-Str $verContent ".sb-item ")
$cntAside        = Count-Str $verContent '<aside class="sidebar">'
$cntDashPattern  = Count-Str $verContent "dash-pattern"
$cntLaS2         = Count-Str $verContent "la-s2"
$cntLaS3         = Count-Str $verContent "la-s3"
$cntLaS4         = Count-Str $verContent "la-s4"
$cntImgLa        = Count-Str $verContent '<img class="la'
$cntUdodov       = Count-Str $verContent "Udodov"
$cntFFFD         = Count-Str $verContent ([char]0xFFFD)
$cntVariantSw    = Count-Str $verContent "sb-variant-switcher"
$cntSbUser       = Count-Str $verContent '<div class="sb-user"'

$cyrCount = 0
foreach ($ch in $verContent.ToCharArray()) {
    $cp = [int]$ch
    if ($cp -ge 0x0400 -and $cp -le 0x04FF) { $cyrCount++ }
}

$vb = [System.IO.File]::ReadAllBytes($targetPath)
$hasBOM  = ($vb.Length -ge 3 -and $vb[0] -eq 0xEF -and $vb[1] -eq 0xBB -and $vb[2] -eq 0xBF)
$cntCRLF = Count-Str $verContent "`r`n"

Write-Host "  'SIDEBAR LAB'            : $cntSidebarLab  (want 0)"
Write-Host "  '#sidebarLab'            : $cntSidebarLabH  (want 0)"
Write-Host "  '.sidebar{' count        : $cntSidebarBase  (want >0)"
Write-Host "  '.sb-item' count         : $cntSbItem  (want >0)"
Write-Host "  '<aside class=sidebar>'  : $cntAside  (want 1)"
Write-Host "  'dash-pattern'           : $cntDashPattern  (want 0)"
Write-Host "  'la-s2'                  : $cntLaS2  (want 0)"
Write-Host "  'la-s3'                  : $cntLaS3  (want 0)"
Write-Host "  'la-s4'                  : $cntLaS4  (want 0)"
Write-Host "  '<img class=la' count    : $cntImgLa  (want 4)"
Write-Host "  'Udodov'                 : $cntUdodov  (want >0)"
Write-Host "  U+FFFD                   : $cntFFFD  (want 0)"
Write-Host "  Cyrillic chars           : $cyrCount  (want >100)"
Write-Host "  Has BOM                  : $hasBOM  (want False)"
Write-Host "  CRLF count               : $cntCRLF  (want >1000)"
Write-Host "  sb-variant-switcher      : $cntVariantSw  (want 0)"
Write-Host "  sb-user div              : $cntSbUser  (want 1)"

$pass = $true
if ($cntSidebarLab  -ne 0)  { Write-Host "FAIL: SIDEBAR LAB still present"; $pass = $false }
if ($cntSidebarLabH -ne 0)  { Write-Host "FAIL: #sidebarLab still present"; $pass = $false }
if ($cntSidebarBase -eq 0)  { Write-Host "FAIL: .sidebar base CSS missing"; $pass = $false }
if ($cntSbItem      -eq 0)  { Write-Host "FAIL: .sb-item CSS missing"; $pass = $false }
if ($cntAside       -ne 1)  { Write-Host "FAIL: <aside class=sidebar> count != 1"; $pass = $false }
if ($cntDashPattern -ne 0)  { Write-Host "FAIL: dash-pattern still present"; $pass = $false }
if ($cntLaS2        -ne 0)  { Write-Host "FAIL: la-s2 still present"; $pass = $false }
if ($cntLaS3        -ne 0)  { Write-Host "FAIL: la-s3 still present"; $pass = $false }
if ($cntLaS4        -ne 0)  { Write-Host "FAIL: la-s4 still present"; $pass = $false }
if ($cntImgLa       -ne 4)  { Write-Host "FAIL: <img class=la count != 4 (got $cntImgLa)"; $pass = $false }
if ($cntUdodov      -eq 0)  { Write-Host "FAIL: Udodov not found"; $pass = $false }
if ($cntFFFD        -ne 0)  { Write-Host "FAIL: U+FFFD replacement chars present"; $pass = $false }
if ($cyrCount       -lt 100){ Write-Host "FAIL: Cyrillic count < 100"; $pass = $false }
if ($hasBOM)                 { Write-Host "FAIL: BOM present"; $pass = $false }
if ($cntCRLF        -lt 1000){ Write-Host "FAIL: CRLF count < 1000"; $pass = $false }
if ($cntVariantSw   -ne 0)  { Write-Host "FAIL: sb-variant-switcher still present"; $pass = $false }
if ($cntSbUser      -ne 1)  { Write-Host "FAIL: sb-user div count != 1 (got $cntSbUser)"; $pass = $false }

if ($pass) {
    Write-Host ""
    Write-Host "ALL CHECKS PASSED"
} else {
    Write-Host ""
    Write-Host "SOME CHECKS FAILED"
}
