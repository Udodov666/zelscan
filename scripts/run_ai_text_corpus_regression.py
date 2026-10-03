from __future__ import annotations

import copy
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from ai_interpreter import AIInterpreter  # noqa: E402


def strings(value, path=''):
    if isinstance(value, dict):
        for key, item in value.items():
            yield from strings(item, f'{path}.{key}' if path else key)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            yield from strings(item, f'{path}[{index}]')
    elif isinstance(value, str):
        yield path, value


def main():
    interpreter = AIInterpreter.__new__(AIInterpreter)
    report_paths = sorted((ROOT / 'cache').rglob('*.json'))
    changed = []
    total_strings = 0
    lengths = []
    for path in report_paths:
        data = json.loads(path.read_text(encoding='utf-8'))
        result = interpreter._sanitize_ai_output(copy.deepcopy(data))
        original_map = dict(strings(data))
        result_map = dict(strings(result))
        for field, original in original_map.items():
            total_strings += 1
            if original.strip():
                lengths.append((len(original.strip()), path.name, field))
            if result_map.get(field) != original:
                changed.append({
                    'source': str(path.relative_to(ROOT)),
                    'path': field,
                    'before': original,
                    'after': result_map.get(field),
                })
    output = {
        'reports': len(report_paths),
        'text_strings': total_strings,
        'sanitizer_changes': len(changed),
        'longest_text_fields': [
            {'characters': n, 'source': src, 'path': field}
            for n, src, field in sorted(lengths, reverse=True)[:25]
        ],
        'sample_changes': changed[:50],
    }
    target = ROOT / 'AI_TEXT_SANITIZER_REGRESSION_REPORT.json'
    target.write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({
        'reports': output['reports'],
        'text_strings': output['text_strings'],
        'sanitizer_changes': output['sanitizer_changes'],
        'report': target.name,
    }, ensure_ascii=False))


if __name__ == '__main__':
    main()
