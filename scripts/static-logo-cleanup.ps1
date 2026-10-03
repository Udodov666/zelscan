$ErrorActionPreference = 'Stop'

$path = 'C:\Users\domas\claude222\zelscass\landing\zelscan_dashboard_static_test.html'
$backup = "$path.bak"
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)

function Count-Matches([string]$Text, [string]$Pattern) {
    return [regex]::Matches($Text, $Pattern).Count
}

try {
    $beforeBytes = [System.IO.File]::ReadAllBytes($path)
    $beforeSize = $beforeBytes.Length
    $c = [System.Text.Encoding]::UTF8.GetString($beforeBytes)

    $petalPattern = '<img class="la la-s[234]"[^>]*>'
    $petalCount = Count-Matches $c $petalPattern
    if ($petalCount -ne 6) { throw "Expected exactly 6 animated petal tags, found $petalCount." }
    $c = [regex]::Replace($c, $petalPattern, '')

    $c = $c.Replace('animation: logoScale var(--logo-t) infinite ease-in-out;', '')
    foreach ($name in @('logoTL', 'logoTR', 'logoBL', 'logoBR')) {
        $c = $c.Replace(";animation:$name var(--logo-t) infinite ease-in-out", '')
    }

    $c = [regex]::Replace($c, '\.dash-logo \.la-s[234]\{[^{}]*\}', '')
    $c = [regex]::Replace($c, '@keyframes\s+(?:logoScale|logoTL|logoTR|logoBL|logoBR|logoL2|logoL3|logoL4)\s*\{(?:[^{}]|\{[^{}]*\})*\}', '')
    $c = $c.Replace('@media(prefers-reduced-motion:reduce){.dash-logo,.dash-logo .la{animation:none!important}}', '')
    $c = [regex]::Replace($c, '\.dash-pattern\{[^{}]*\}', '')
    $c = $c.Replace('.dash-pattern,', '')

    $c = $c -replace "`r?`n", "`r`n"
    [System.IO.File]::WriteAllText($path, $c, $utf8NoBom)

    $afterBytes = [System.IO.File]::ReadAllBytes($path)
    $afterSize = $afterBytes.Length
    $after = [System.Text.Encoding]::UTF8.GetString($afterBytes)

    $counts = [ordered]@{
        'img class="la' = Count-Matches $after '<img class="la'
        'la-s2 + la-s3 + la-s4' = Count-Matches $after 'la-s[234]'
        'animation:logo' = Count-Matches $after 'animation:logo'
        '@keyframes logo' = Count-Matches $after '@keyframes\s+logo'
        'dash-pattern' = Count-Matches $after 'dash-pattern'
        'U+FFFD' = Count-Matches $after ([string][char]0xFFFD)
        'Cyrillic characters' = Count-Matches $after '[\u0400-\u04FF]'
        'CRLF' = Count-Matches $after "`r`n"
    }

    $startsDoctype = $after.StartsWith('<!DOCTYPE html>')
    $hasBom = $afterBytes.Length -ge 3 -and $afterBytes[0] -eq 0xEF -and $afterBytes[1] -eq 0xBB -and $afterBytes[2] -eq 0xBF

    if ($counts['img class="la'] -ne 4) { throw "Expected 4 remaining logo images, found $($counts['img class=`"la'])." }
    if ($counts['la-s2 + la-s3 + la-s4'] -ne 0) { throw 'Found remaining la-s2/la-s3/la-s4 occurrences.' }
    if ($counts['animation:logo'] -ne 0) { throw 'Found remaining animation:logo occurrences.' }
    if ($counts['@keyframes logo'] -ne 0) { throw 'Found remaining @keyframes logo occurrences.' }
    if ($counts['dash-pattern'] -ne 0) { throw 'Found remaining dash-pattern occurrences.' }
    if ($counts['U+FFFD'] -ne 0) { throw 'Found Unicode replacement characters.' }
    if ($counts['Cyrillic characters'] -le 100) { throw "Expected more than 100 Cyrillic characters, found $($counts['Cyrillic characters'])." }
    if (-not $startsDoctype) { throw 'File does not start with <!DOCTYPE html>.' }
    if ($hasBom) { throw 'UTF-8 BOM detected.' }
    if ($counts['CRLF'] -le 1000) { throw "Expected more than 1000 CRLF sequences, found $($counts['CRLF'])." }

    Write-Host ('Before bytes: {0} ({1:N3} MB)' -f $beforeSize, ($beforeSize / 1MB))
    Write-Host ('After bytes:  {0} ({1:N3} MB)' -f $afterSize, ($afterSize / 1MB))
    Write-Host "Removed animated petal tags: $petalCount"
    foreach ($entry in $counts.GetEnumerator()) { Write-Host ("{0}: {1}" -f $entry.Key, $entry.Value) }
    Write-Host "Starts with <!DOCTYPE html>: $startsDoctype"
    Write-Host "UTF-8 BOM present: $hasBom"
    Write-Host 'All assertions passed.'
}
catch {
    if (Test-Path -LiteralPath $backup) {
        [System.IO.File]::Copy($backup, $path, $true)
        Write-Host 'Assertion or processing failure: restored target from backup.'
    }
    throw
}
