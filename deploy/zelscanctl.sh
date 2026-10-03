#!/usr/bin/env bash
set -Eeuo pipefail
ACTION=${1:-status}
case "$ACTION" in
  start|restart|stop) sudo systemctl "$ACTION" zelscan-backend zelscan-frontend nginx ;;
  status) systemctl --no-pager --full status zelscan-backend zelscan-frontend nginx ;;
  logs) journalctl -u zelscan-backend -u zelscan-frontend -n 200 --no-pager ;;
  health)
    python3 - <<'PY'
import urllib.request
for url in ('http://127.0.0.1:5050/api/health', 'http://127.0.0.1:8080/'):
    try:
        with urllib.request.urlopen(url, timeout=5) as r:
            print(url, r.status)
    except Exception as e:
        print(url, 'FAILED', type(e).__name__)
        raise SystemExit(1)
PY
    ;;
  *) echo 'Usage: zelscanctl.sh {start|restart|stop|status|logs|health}'; exit 2 ;;
esac
