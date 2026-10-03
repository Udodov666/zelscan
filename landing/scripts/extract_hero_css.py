import re
from pathlib import Path

src = Path('landing/assets/css/pages/zelscan.css').read_text(encoding='utf-8')

# Selectors (at top level or inside @media) that belong to the hero block.
HERO_TOKENS = [
    '.hero', '.tile', '.tag', '.track', '.hero-view', '.hero-meta',
    '.hero-tags', '.hero-name', '.hero-ava', '.hero-id', '.hero-top',
    '.hero-desc', '.hero-div', '.hero-dots', '.tiles', '.lab', '.val',
    '.lbl', '.share', '.tl',
]

def selector_is_hero(sel: str) -> bool:
    # a selector list -> hero if ANY comma-part references a hero token
    parts = [p.strip() for p in sel.split(',')]
    for p in parts:
        for tok in HERO_TOKENS:
            # token matches a class name or a class-name prefix (.tile -> .tile-ghost)
            if re.search(re.escape(tok) + r'(?![\w])', p):
                return True
    return False

i = 0
n = len(src)
out_blocks = []

def parse_block(text):
    """Return list of (selector, body_with_braces) top-level rules and @-rules."""
    rules = []
    j = 0
    m = len(text)
    while j < m:
        # skip comments
        if text[j:j+2] == '/*':
            end = text.find('*/', j+2)
            if end == -1:
                break
            j = end + 2
            continue
        if text[j] in ' \t\r\n;':
            j += 1
            continue
        # read selector/prelude up to { 
        start = j
        depth = 0
        while j < m and text[j] != '{':
            j += 1
        prelude = text[start:j].strip()
        if j >= m:
            break
        # now capture balanced braces
        bstart = j
        depth = 0
        while j < m:
            c = text[j]
            if c == '{':
                depth += 1
            elif c == '}':
                depth -= 1
                if depth == 0:
                    j += 1
                    break
            j += 1
        body = text[bstart:j]
        rules.append((prelude, body))
    return rules

top_rules = parse_block(src)

for prelude, body in top_rules:
    if prelude.startswith('@media') or prelude.startswith('@supports'):
        inner = body[body.find('{')+1:body.rfind('}')]
        inner_rules = parse_block(inner)
        kept = [(p, b) for (p, b) in inner_rules if not p.startswith('@') and selector_is_hero(p)]
        if kept:
            chunk = prelude + ' {\n'
            for p, b in kept:
                chunk += '  ' + p + ' ' + b + '\n'
            chunk += '}\n'
            out_blocks.append(chunk)
    else:
        if selector_is_hero(prelude):
            out_blocks.append(prelude + ' ' + body + '\n')

header = ('/* report-hero.css — SINGLE SOURCE OF TRUTH for the report hero block.\n'
          '   Extracted from pages/zelscan.css so every report tab (overview,\n'
          '   activity, behavior, psychology, analysis) renders an identical hero.\n'
          '   Do not duplicate hero rules in per-page CSS. */\n\n')

Path('landing/assets/css/report-hero.css').write_text(header + '\n'.join(out_blocks), encoding='utf-8')
print('rules kept:', len(out_blocks))
print('bytes:', len(header) + sum(len(b) for b in out_blocks))
