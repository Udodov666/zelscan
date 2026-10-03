# fix-sidebar-visibility.ps1
# Makes exactly 4 targeted string replacements in the dashboard HTML file.
# Reads/writes UTF-8 without BOM. Restores from backup if any check fails.

$target = "C:\Users\domas\claude222\zelscass\landing\zelscan_dashboard_static_test.html"
$backup = "C:\Users\domas\claude222\zelscass\landing\zelscan_dashboard_static_test.pre-render-fix.html"

# --- Read file as raw bytes, decode as UTF-8 ---
$bytes = [System.IO.File]::ReadAllBytes($target)
$beforeSize = $bytes.Length
Write-Host "Before size: $beforeSize bytes"

# Strip BOM if present
if ($bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF) {
    $bytes = $bytes[3..($bytes.Length-1)]
    Write-Host "WARNING: BOM was present and stripped before processing."
}

$content = [System.Text.Encoding]::UTF8.GetString($bytes)

# --- CHANGE 1: Remove sidebar hide rule (~line 1495) ---
# Build the Cyrillic comment text using char codes to avoid encoding issues
$cyrComment = "    /* " + [char]0x421 + [char]0x43A + [char]0x440 + [char]0x44B + [char]0x442 + [char]0x44C + " " + [char]0x441 + [char]0x442 + [char]0x430 + [char]0x440 + [char]0x44B + [char]0x439 + " sidebar " + [char]0x434 + [char]0x43E + " " + [char]0x437 + [char]0x430 + [char]0x43C + [char]0x435 + [char]0x43D + [char]0x44B + " */"
$old1 = $cyrComment + "`r`n    .sidebar:not(#sidebarLab), .frame .sidebar { display: none !important; }"
$new1 = ""
$count1 = ([regex]::Matches($content, [regex]::Escape($old1))).Count
Write-Host "CHANGE 1 matches found: $count1"
if ($count1 -gt 0) {
    $content = $content.Replace($old1, $new1)
    Write-Host "CHANGE 1 applied."
} else {
    Write-Host "CHANGE 1: pattern not found, skipping."
}

# --- CHANGE 2: Remove SidebarLab mobile hide rule (~line 816) ---
$old2 = "/* the sidebar is desktop-only now " + [char]0x2014 + " the tab bar replaces it on mobile */`r`nbody #sidebarLab.sidebar{display:none!important}"
$new2 = ""
$count2 = ([regex]::Matches($content, [regex]::Escape($old2))).Count
Write-Host "CHANGE 2 matches found: $count2"
if ($count2 -gt 0) {
    $content = $content.Replace($old2, $new2)
    Write-Host "CHANGE 2 applied."
} else {
    Write-Host "CHANGE 2: pattern not found, skipping."
}

# --- CHANGE 3: Fix responsive rule hiding sidebar text labels at <1180px (~line 762) ---
$old3 = ".sb-item span,.sb-user .who,.sb-user .menu{display:none}"
$new3 = ".sb-user .menu{display:none}"
$count3 = ([regex]::Matches($content, [regex]::Escape($old3))).Count
Write-Host "CHANGE 3 matches found: $count3"
if ($count3 -gt 0) {
    $content = $content.Replace($old3, $new3)
    Write-Host "CHANGE 3 applied."
} else {
    Write-Host "CHANGE 3: pattern not found, skipping."
}

# --- CHANGE 4: Remove end-of-document safety rule added by previous fix ---
# Find block starting with @media (min-width:901px){ that contains body .content>.sidebar
$mediaPattern = [regex]'@media \(min-width:901px\)\{[^}]*body \.content>\.sidebar[^}]*\}'
$match4 = $mediaPattern.Match($content)
if ($match4.Success) {
    Write-Host "CHANGE 4 match found at index $($match4.Index), length $($match4.Length)"
    $content = $content.Remove($match4.Index, $match4.Length)
    Write-Host "CHANGE 4 applied."
} else {
    Write-Host "CHANGE 4: pattern not found, skipping."
}

# --- Write back as UTF-8 without BOM, preserving CRLF ---
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
$outBytes = $utf8NoBom.GetBytes($content)
[System.IO.File]::WriteAllBytes($target, $outBytes)
$afterSize = $outBytes.Length
Write-Host "After size: $afterSize bytes"

# --- Verification ---
Write-Host "`n=== VERIFICATION ==="

# Re-read for verification
$verifyBytes = [System.IO.File]::ReadAllBytes($target)
$verifyContent = [System.Text.Encoding]::UTF8.GetString($verifyBytes)

# Check 1: .sidebar:not(#sidebarLab) count must be 0
$check1 = ([regex]::Matches($verifyContent, [regex]::Escape(".sidebar:not(#sidebarLab)"))).Count
Write-Host "CHECK 1 - '.sidebar:not(#sidebarLab)' count (must be 0): $check1"

# Check 2: body #sidebarLab.sidebar{display:none count must be 0
$check2 = ([regex]::Matches($verifyContent, [regex]::Escape("body #sidebarLab.sidebar{display:none"))).Count
Write-Host "CHECK 2 - 'body #sidebarLab.sidebar{display:none' count (must be 0): $check2"

# Check 3: <aside class="sidebar"> must exist exactly once
$check3 = ([regex]::Matches($verifyContent, [regex]::Escape('<aside class="sidebar">'))).Count
Write-Host "CHECK 3 - '<aside class=""sidebar"">' count (must be 1): $check3"

# Check 4: Удодов or Udodov must exist
$check4a = ([regex]::Matches($verifyContent, [regex]::Escape("Удодов"))).Count
$check4b = ([regex]::Matches($verifyContent, [regex]::Escape("Udodov"))).Count
$check4 = $check4a + $check4b
Write-Host "CHECK 4 - 'Удодов' or 'Udodov' count (must be > 0): $check4"

# Check 5: U+FFFD replacement chars must be 0
$check5 = ([regex]::Matches($verifyContent, [regex]::Escape([char]0xFFFD))).Count
Write-Host "CHECK 5 - U+FFFD replacement chars (must be 0): $check5"

# Check 6: Cyrillic chars > 100
$cyrillicMatches = [regex]::Matches($verifyContent, '[\u0400-\u04FF]')
$check6 = $cyrillicMatches.Count
Write-Host "CHECK 6 - Cyrillic chars (must be > 100): $check6"

# Check 7: No BOM
$check7bom = ($verifyBytes.Length -ge 3 -and $verifyBytes[0] -eq 0xEF -and $verifyBytes[1] -eq 0xBB -and $verifyBytes[2] -eq 0xBF)
Write-Host "CHECK 7 - BOM present (must be false): $check7bom"

# Check 8: CRLF count > 1000
$check8 = ([regex]::Matches($verifyContent, "`r`n")).Count
Write-Host "CHECK 8 - CRLF count (must be > 1000): $check8"

# Check 9: File starts with <!DOCTYPE html>
$check9 = $verifyContent.StartsWith("<!DOCTYPE html>")
Write-Host "CHECK 9 - Starts with '<!DOCTYPE html>' (must be true): $check9"

# --- Evaluate all checks ---
$allPassed = (
    $check1 -eq 0 -and
    $check2 -eq 0 -and
    $check3 -eq 1 -and
    $check4 -gt 0 -and
    $check5 -eq 0 -and
    $check6 -gt 100 -and
    (-not $check7bom) -and
    $check8 -gt 1000 -and
    $check9
)

if ($allPassed) {
    Write-Host "`nALL CHECKS PASSED. Script completed successfully."
} else {
    Write-Host "`nONE OR MORE CHECKS FAILED. Restoring from backup..."
    if (Test-Path $backup) {
        Copy-Item -Path $backup -Destination $target -Force
        Write-Host "Restored from backup: $backup"
    } else {
        Write-Host ("ERROR: Backup file not found at " + $backup + " - cannot restore!")
    }
    exit 1
}
