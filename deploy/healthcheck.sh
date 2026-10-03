#!/usr/bin/env bash
set -Eeuo pipefail
python3 - <<'PY'
import urllib.request
checks = [('backend', 'http://127.0.0.1:5050/api/health'), ('frontend', 'http://127.0.0.1:8080/')]
for name, url in checks:
    try:
        with urllib.request.urlopen(url, timeout=5) as response:
            if response.status >= 500:
                raise RuntimeError(f'HTTP {response.status}')
            print(f'{name}: OK ({response.status})')
    except Exception as exc:
        print(f'{name}: FAILED ({type(exc).__name__})')
        raise SystemExit(1)
PY
