#!/usr/bin/env bash
cd "$(dirname "$0")"
echo "[1/2] backend :5050"
python app/server.py &
sleep 2
echo "[2/2] frontend :8080"
python app/front_server.py &
sleep 2
xdg-open http://localhost:8080 2>/dev/null || open http://localhost:8080 2>/dev/null || echo "→ http://localhost:8080"
wait
