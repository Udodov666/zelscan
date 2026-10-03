from pathlib import Path
import re

ROOT = Path(r"C:\Users\domas\claude222\zelscass")
FILES = [
    Path(r"landing\zelscan_analysis.html"),
    Path(r"landing\zelscan_activity.html"),
    Path(r"landing\zelscan_psychology.html"),
    Path(r"landing\zelscan_behavior.html"),
    Path(r"landing\assets\css\pages\zelscan_dashboard.css"),
    Path(r"landing\assets\dashboard2\css\zelscan_dashboard.dashboard2.css"),
    Path(r"landing\assets\css\pages\zelscan_psychology.css"),
]

# A mojibake word is a sequence of the characteristic lead characters
# (Р, С, в) plus their cp1251 continuation characters. Repair only such
# sequences, leaving already-correct Russian text untouched.
PATTERN = re.compile(r'(?:Р.|С.|вЂ.|в„–|в„ў)+')

def repair(match):
    s = match.group(0)
    try:
        fixed = s.encode('cp1251').decode('utf-8')
    except UnicodeError:
        return s
    # Accept only a meaningful reversal: it must remove mojibake lead pairs.
    if 'Р' not in fixed and 'С' not in fixed and 'вЂ' not in fixed:
        return fixed
    return s

for rel in FILES:
    path = ROOT / rel
    text = path.read_text(encoding='utf-8')
    new = PATTERN.sub(repair, text)
    path.write_text(new, encoding='utf-8', newline='')
    remaining = len(re.findall(r'(?:Р.|С.|вЂ.)+', new))
    print(f'{rel}: remaining suspicious sequences={remaining}')
