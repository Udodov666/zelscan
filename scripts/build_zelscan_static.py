from pathlib import Path
import re

root = Path(r"C:/Users/domas/claude222/zelscass")
source_html = root / "landing/zelscan_dashboard.html"
source_css = root / "landing/assets/css/pages/zelscan_dashboard.css"
out = root / "landing/zelscan_dashboard_static_test.html"

html = source_html.read_text(encoding="utf-8")
css = source_css.read_text(encoding="utf-8")
body = re.search(r"<body[^>]*>(.*?)</body>", html, re.S | re.I).group(1)
body = re.sub(r"<script\b[^>]*>.*?</script\s*>", "", body, flags=re.S | re.I)
body = re.sub(r"<template\b[^>]*>.*?</template\s*>", "", body, flags=re.S | re.I)
body = re.sub(r"<(?:canvas|img)\b[^>]*>", "", body, flags=re.I)
body = re.sub(r"\s(?:onclick|onload|onerror|oninput|onchange|onkeydown|onkeyup|onmousedown|onmouseup|ontouchstart|ontouchend)=(?:\"[^\"]*\"|'[^']*')", "", body, flags=re.I)
body = re.sub(r'<div class="modal-bg".*', "", body, flags=re.S | re.I)
body = re.sub(r'<div class="dash-prog".*?</div>\s*</div>', "", body, flags=re.S | re.I)
body = re.sub(r'<div class="dash-err".*?</div>\s*</div>', "", body, flags=re.S | re.I)
body = re.sub(r'<div class="sel-chip".*?</div>\s*</div>', "", body, flags=re.S | re.I)
body = re.sub(r'<div class="dr3-rail">.*?</div>\s*</div>', '<div class="dr3-rail"><div class="dr3-track"><article class="dr3-card"><div class="dr3-name">Свежие публичные отчёты</div><div class="dr3-sub">Статичный предпросмотр Dashboard</div></article></div></div>', body, flags=re.S | re.I)
body = re.sub(r"\s(?:src|href)=([\"'])(?!#)[^\"']*\1", "", body, flags=re.I)
css = re.sub(r"@keyframes\s+[^{]+\{(?:[^{}]|\{[^{}]*\})*\}", "", css, flags=re.S | re.I)
css = re.sub(r"@property\s+[^{]+\{[^{}]*\}", "", css, flags=re.S | re.I)
css = re.sub(r"url\([^)]*\)", "none", css, flags=re.I)
css = re.sub(r"(?:-webkit-)?animation(?:-[\w-]+)?\s*:[^;}{]+;?", "", css, flags=re.I)
css = re.sub(r"transition(?:-[\w-]+)?\s*:[^;}{]+;?", "", css, flags=re.I)
extra = "html,body{display:block!important;visibility:visible!important;opacity:1!important;min-height:100%;background:#050505;color:#fff}.frame,.content,.main,.dash,.dash-hero{display:flex!important;visibility:visible!important;opacity:1!important}.frame{width:min(100%,1921px)!important}.content,.header{width:min(1360px,calc(100% - 32px))!important}.main,.dash,.dash-hero{width:100%!important}.dash-logo-wrap{width:54px;height:54px;background:radial-gradient(circle at 35% 30%,#6ee7b7,#059669 55%,#064e3b);box-shadow:0 0 40px rgba(52,211,153,.35)}.dash-logo{display:none!important}.modal-bg,.dash-prog,.dash-err,.sel-chip,.dash-dd,.glow-canvas,[hidden]{display:none!important}*,*::before,*::after{animation:none!important;transition:none!important}"
doc = '<!DOCTYPE html>\n<html lang="ru"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>zelscan · Дашборд</title><style>' + css + extra + '</style></head><body>' + body + '</body></html>'
out.write_text(doc, encoding="utf-8", newline="\n")
