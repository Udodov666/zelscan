#!/usr/bin/env bash
# Zelscan watchdog: проверяет диск, память и живость сервисов.
# Пишет в journald (видно через: journalctl -t zelscan-monitor).
# При падении backend/frontend/nginx — пробует автоперезапуск.
# Порог диска настраивается через DISK_THRESHOLD (по умолчанию 85%).
# Телеграм-алерт: задайте TG_BOT_TOKEN и TG_CHAT_ID (env или /etc/zelscan/monitor.env).
set -uo pipefail

DISK_THRESHOLD=${DISK_THRESHOLD:-85}
SERVICES=(zelscan-backend zelscan-frontend nginx)
HEALTH_URL=${HEALTH_URL:-http://127.0.0.1:5050/api/health}

# Необязательный конфиг с секретами алертов.
[[ -f /etc/zelscan/monitor.env ]] && . /etc/zelscan/monitor.env

log()  { logger -t zelscan-monitor -- "$1"; echo "$1"; }

notify() {
  local msg="$1"
  if [[ -n "${TG_BOT_TOKEN:-}" && -n "${TG_CHAT_ID:-}" ]]; then
    curl -s --max-time 10 \
      "https://api.telegram.org/bot${TG_BOT_TOKEN}/sendMessage" \
      -d chat_id="${TG_CHAT_ID}" \
      --data-urlencode text="[zelscan] $msg" >/dev/null 2>&1 || true
  fi
}

alert() { log "ALERT: $1"; notify "$1"; }

# ── Диск ──────────────────────────────────────────────────────────────────────
DISK_USE=$(df --output=pcent / | tail -1 | tr -dc '0-9')
if (( DISK_USE >= DISK_THRESHOLD )); then
  alert "Диск / заполнен на ${DISK_USE}% (порог ${DISK_THRESHOLD}%)"
fi

# ── Память ────────────────────────────────────────────────────────────────────
MEM_AVAIL_MB=$(free -m | awk '/^Mem:/ {print $7}')
if (( MEM_AVAIL_MB < 200 )); then
  alert "Мало свободной памяти: ${MEM_AVAIL_MB} MB"
fi

# ── Сервисы (+ автоперезапуск) ─────────────────────────────────────────────────
for svc in "${SERVICES[@]}"; do
  if ! systemctl is-active --quiet "$svc"; then
    alert "Сервис $svc не активен — пробую перезапустить"
    systemctl restart "$svc" 2>/dev/null || true
    sleep 3
    if systemctl is-active --quiet "$svc"; then
      log "OK: $svc перезапущен успешно"
    else
      alert "НЕ УДАЛОСЬ перезапустить $svc"
    fi
  fi
done

# ── HTTP health ─────────────────────────────────────────────────────────────
CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 "$HEALTH_URL" || echo 000)
if [[ "$CODE" != "200" ]]; then
  alert "Health-check вернул HTTP $CODE ($HEALTH_URL)"
fi

exit 0
