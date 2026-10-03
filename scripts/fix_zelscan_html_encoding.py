"""
Чинит двойную перекодировку (mojibake) в landing/zelscan.html.

Симптом: русский UTF-8 текст был когда-то прочитан как Windows-1251 и заново
сохранён в UTF-8, из-за чего "Большая пятёрка" стало "Р‘РѕР»СЊС€Р°СЏ РїСЏС‚С‘СЂРєР°".

Починка: для каждого символа пытаемся выполнить обратную операцию
s.encode('cp1251').decode('utf-8'). Делаем это по «сегментам» текста между
HTML-тегами и только когда сегмент действительно похож на mojibake, чтобы не
трогать латиницу, цифры и валидную разметку.
"""
import io
import re
import sys
from pathlib import Path

TARGET = Path(__file__).resolve().parent.parent / "landing" / "zelscan.html"

# Признак mojibake: наличие типичных «Р…»/«С…» пар кириллицы-в-1251.
MOJIBAKE_HINT = re.compile(r"[РСЂВВ°Т][\u0080-\u04FF]")


def try_fix_fragment(text: str) -> str:
    """Пытается восстановить один текстовый фрагмент. При неудаче — возвращает как есть."""
    if not MOJIBAKE_HINT.search(text):
        return text
    try:
        restored = text.encode("cp1251").decode("utf-8")
    except (UnicodeEncodeError, UnicodeDecodeError):
        # Фрагмент содержит символы вне cp1251 — чиним посимвольно.
        out = []
        for ch in text:
            try:
                out.append(ch.encode("cp1251").decode("utf-8"))
            except (UnicodeEncodeError, UnicodeDecodeError):
                out.append(ch)
        restored = "".join(out)
    # Защита: восстановление должно уменьшать число «Р»-маркеров, иначе откат.
    if restored.count("Р") + restored.count("С") <= text.count("Р") + text.count("С"):
        return restored
    return text


def main() -> int:
    if not TARGET.exists():
        print(f"NOT FOUND: {TARGET}")
        return 1

    raw = TARGET.read_bytes()
    # Убираем BOM для обработки, вернём при записи.
    had_bom = raw.startswith(b"\xef\xbb\xbf")
    content = raw.decode("utf-8-sig")

    before_markers = content.count("Р") + content.count("С")

    # Разбиваем на теги (<...>) и текст между ними.
    parts = re.split(r"(<[^>]*>)", content)
    # Значения текстовых атрибутов, которые тоже видит пользователь и которые
    # могли пострадать (placeholder, title, alt, value, aria-label, data-*).
    attr_re = re.compile(
        r'((?:placeholder|title|alt|value|aria-label|content|data-[\w-]+)\s*=\s*")([^"]*)(")'
    )
    for i, part in enumerate(parts):
        if part.startswith("<") and part.endswith(">"):
            # Внутри тега чиним только значения человекочитаемых атрибутов.
            parts[i] = attr_re.sub(
                lambda m: m.group(1) + try_fix_fragment(m.group(2)) + m.group(3),
                part,
            )
            continue
        parts[i] = try_fix_fragment(part)
    fixed = "".join(parts)

    after_markers = fixed.count("Р") + fixed.count("С")

    # Резервная копия рядом с файлом.
    backup = TARGET.with_suffix(TARGET.suffix + ".before_encoding_fix")
    if not backup.exists():
        backup.write_bytes(raw)

    out_bytes = fixed.encode("utf-8")
    if had_bom:
        out_bytes = b"\xef\xbb\xbf" + out_bytes
    TARGET.write_bytes(out_bytes)

    print(f"OK: backup -> {backup.name}")
    print(f"markers Р/С before={before_markers} after={after_markers}")
    return 0


if __name__ == "__main__":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    raise SystemExit(main())
