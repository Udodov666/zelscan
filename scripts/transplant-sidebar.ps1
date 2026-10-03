$ErrorActionPreference = 'Stop'

$target  = 'C:\Users\domas\claude222\zelscass\landing\zelscan_dashboard_static_test.html'
$backup  = 'C:\Users\domas\claude222\zelscass\landing\zelscan_dashboard_static_test.pre-transplant.html'
$jsFile  = 'C:\Users\domas\claude222\zelscass\landing\assets\js\sidebar-lab.js'
$htmlFb  = 'C:\Users\domas\claude222\zelscass\landing\assets\js\sidebar-lab.html'
$cssFile = 'C:\Users\domas\claude222\zelscass\landing\assets\css\sidebar-lab.css'

$enc = New-Object System.Text.UTF8Encoding($false)

# 1) backup
if (-not (Test-Path $backup)) { Copy-Item $target $backup }

# 2) read target
$html = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($target))
$before = $html.Length
$beforeBytes = ([System.IO.File]::ReadAllBytes($target)).Length

# 3) extract SIDEBAR_HTML from js
$sb = $null
if (Test-Path $jsFile) {
    $js = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($jsFile))
    $marker = 'const SIDEBAR_HTML = '
    $idx = $js.IndexOf($marker)
    if ($idx -ge 0) {
        $btOpen = $js.IndexOf('`', $idx + $marker.Length)
        if ($btOpen -ge 0) {
            $btClose = $js.IndexOf('`', $btOpen + 1)
            if ($btClose -gt $btOpen) {
                $sb = $js.Substring($btOpen + 1, $btClose - $btOpen - 1)
            }
        }
    }
}

if ($sb -and $sb.Contains('id="sidebarLab"')) {
    # resolve template expressions -> static counts
    $sb = [regex]::Replace($sb, '(data-count="my_dossiers"[^>]*>)\$\{[^}]*\}', '${1}0')
    $sb = [regex]::Replace($sb, '(data-count="public_dossiers"[^>]*>)\$\{[^}]*\}', '${1}38')
    $sb = [regex]::Replace($sb, '(data-count="transactions"[^>]*>)\$\{[^}]*\}', '${1}4')
    # defensive: remove any remaining ${...}
    $sb = [regex]::Replace($sb, '\$\{[^}]*\}', '')
    Write-Host "SIDEBAR source: JS SIDEBAR_HTML"
} else {
    # fallback
    $sb = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($htmlFb))
    # swap secondary support link -> news
    $sb = $sb.Replace('https://t.me/udodov228', 'news.html')
    $sb = $sb.Replace([char]0x041F + [char]0x043E + [char]0x0434 + [char]0x0434 + [char]0x0435 + [char]0x0440 + [char]0x0436 + [char]0x043A + [char]0x0430, [char]0x041D + [char]0x043E + [char]0x0432 + [char]0x043E + [char]0x0441 + [char]0x0442 + [char]0x0438)
    $sb = [regex]::Replace($sb, 'fa-[a-z0-9-]*telegram[a-z0-9-]*', 'fa-newspaper')
    Write-Host "SIDEBAR source: HTML fallback"
}

# 4) replace legacy aside (first occurrence, no id)
$rx = [regex]::new('<aside class="sidebar">.*?</aside>', [System.Text.RegularExpressions.RegexOptions]::Singleline)
$mc = $rx.Matches($html)
$legacyBefore = $mc.Count
$html = $rx.Replace($html, [System.Text.RegularExpressions.MatchEvaluator]{ param($m) $script:sb }, 1)

# 5) inline css before first </head>
$css = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($cssFile))
$styleBlock = "<style id=""sidebar-lab-css"">" + $css + "`r`n/* production overrides */`r`n#sidebarLab .sb-variant-switcher{display:none!important}`r`n#sidebarLab .sb-icon-solid{display:none!important}`r`n#sidebarLab .sb-icon-line{display:block!important}`r`n#sidebarLab.sidebar{display:flex!important}`r`n</style>"
$headIdx = $html.IndexOf('</head>')
if ($headIdx -ge 0) {
    $html = $html.Substring(0, $headIdx) + $styleBlock + $html.Substring($headIdx)
}

# 6) remove conflicting legacy CSS
$html = [regex]::Replace($html, '\.sidebar\{[^}]*border:1px solid #121212[^}]*\}', '')
# remove legacy sidebar CSS section between /* SIDEBAR */ and /* MAIN */
$sIdx = $html.IndexOf('/* SIDEBAR */')
$mIdx = $html.IndexOf('/* MAIN */')
if ($sIdx -ge 0 -and $mIdx -gt $sIdx) {
    $html = $html.Substring(0, $sIdx) + $html.Substring($mIdx)
}
# remove unscoped hides
$html = [regex]::Replace($html, '\.sidebar:not\(#sidebarLab\)[^{]*\{[^}]*\}', '')
$html = [regex]::Replace($html, '#sidebarLab\.sidebar\{display:none[^}]*\}', '')
$html = [regex]::Replace($html, 'body \.content>\.sidebar\{[^}]*\}', '')

# 7) write back
[System.IO.File]::WriteAllText($target, $html, $enc)

# 8) validate
$html = [System.Text.Encoding]::UTF8.GetString([System.IO.File]::ReadAllBytes($target))
$afterBytes = ([System.IO.File]::ReadAllBytes($target)).Length

function CountOf($s,$needle){ if([string]::IsNullOrEmpty($s) -or [string]::IsNullOrEmpty($needle)){return 0}; return ([regex]::Matches($s,[regex]::Escape($needle))).Count }

$asideWithId = CountOf $html '<aside class="sidebar" id="sidebarLab"'
$legacyAsideTotal = CountOf $html '<aside class="sidebar">'
$legacyAside = $legacyAsideTotal - $asideWithId
$newsHtml    = CountOf $html 'news.html'
$sbSecondary = CountOf $html 'sb-secondary'
$hasSbUser   = CountOf $html 'id="sbUser"'
$cssInlined  = CountOf $html '--sb-item-height'
$displayFlex = CountOf $html '#sidebarLab.sidebar{display:flex'
$apiCount    = CountOf $html '/api/'
$dashPattern = CountOf $html 'dash-pattern'
$laFrames    = (CountOf $html 'la-s2') + (CountOf $html 'la-s3') + (CountOf $html 'la-s4')
$laImgs      = CountOf $html '<img class="la'

# link/script with assets/
$extLinkAssets = 0
$extScriptAssets = 0
foreach ($line in ($html -split "`n")) {
    if ($line -match '<link' -and $line -match 'assets/') { $extLinkAssets++ }
    if ($line -match '<script src=' -and $line -match 'assets/') { $extScriptAssets++ }
}

# fffd
$fffd = ([regex]::Matches($html, [regex]::Escape([string][char]0xFFFD))).Count
# cyrillic
$cyr = ([regex]::Matches($html, '\p{IsCyrillic}')).Count
# bom
$rawBytes = [System.IO.File]::ReadAllBytes($target)
$bom = ($rawBytes.Length -ge 3 -and $rawBytes[0] -eq 0xEF -and $rawBytes[1] -eq 0xBB -and $rawBytes[2] -eq 0xBF)

Write-Host "===== VALIDATION ====="
Write-Host "asideWithId    = $asideWithId (expect 1)"
Write-Host "legacyAside    = $legacyAside (expect 0)"
Write-Host "legacyAsideTot = $legacyAsideTotal"
Write-Host "legacyBefore   = $legacyBefore"
Write-Host "newsHtml       = $newsHtml (news.html present)"
Write-Host "sbSecondary    = $sbSecondary"
Write-Host "hasSbUser      = $hasSbUser (expect 0) id-sbUser"
Write-Host "cssInlined     = $cssInlined (expect >0) sb-item-height"
Write-Host "displayFlex    = $displayFlex (expect >=1) sidebarLab-display-flex"
Write-Host "extLinkAssets  = $extLinkAssets (expect 0)"
Write-Host "extScriptAssets= $extScriptAssets (expect 0)"
Write-Host "apiCount       = $apiCount (expect 0) api-slash"
Write-Host "dashPattern    = $dashPattern (expect 0) dash-pattern"
Write-Host "laFrames       = $laFrames (expect 0) la-s2-s3-s4"
Write-Host "laImgs         = $laImgs (expect 4) img-class-la"
Write-Host "fffd           = $fffd (expect 0)"
Write-Host "cyr            = $cyr (expect >100)"
Write-Host "bom            = $bom (expect false)"
Write-Host "beforeBytes    = $beforeBytes"
Write-Host "afterBytes     = $afterBytes"

if ($asideWithId -ne 1 -or $legacyAside -gt 0 -or $fffd -gt 0) {
    Copy-Item $backup $target -Force
    Write-Host "FAILED: restored from backup. Reason: asideWithId=$asideWithId legacyAside=$legacyAside fffd=$fffd"
} else {
    Write-Host "SUCCESS"
}
