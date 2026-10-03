#!/usr/bin/env bash
set -Eeuo pipefail

APP_USER=${APP_USER:-zelscan}
APP_DIR=${APP_DIR:-/opt/zelscan}
SOURCE_DIR=${1:-}

if [[ $EUID -ne 0 ]]; then echo 'Run as root (sudo).'; exit 1; fi
if [[ -z "$SOURCE_DIR" || ! -d "$SOURCE_DIR" ]]; then echo "Usage: sudo $0 /path/to/transferred/zelscan"; exit 1; fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y python3 python3-venv python3-pip nginx sqlite3 rsync ufw ca-certificates
id "$APP_USER" >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin "$APP_USER"
mkdir -p "$APP_DIR" /etc/zelscan /var/backups/zelscan /var/www/letsencrypt
chmod 700 /etc/zelscan /var/backups/zelscan

# Copy without deleting destination files. Existing DB, WAL/SHM, cache, private
# data, logs and secrets are never removed by this script.
rsync -a --no-owner --no-group "$SOURCE_DIR"/ "$APP_DIR"/
python3 -m venv "$APP_DIR/.venv"
"$APP_DIR/.venv/bin/pip" install --upgrade pip
"$APP_DIR/.venv/bin/pip" install -r "$APP_DIR/requirements.txt"

if [[ ! -f /etc/zelscan/zelscan.env ]]; then
  install -m 600 "$APP_DIR/deploy/env.production.example" /etc/zelscan/zelscan.env
fi
install -m 644 "$APP_DIR/deploy/systemd/zelscan-backend.service" /etc/systemd/system/zelscan-backend.service
install -m 644 "$APP_DIR/deploy/systemd/zelscan-frontend.service" /etc/systemd/system/zelscan-frontend.service
install -m 644 "$APP_DIR/deploy/nginx/zelscan.conf" /etc/nginx/sites-available/zelscan.conf
[[ -e /etc/nginx/sites-enabled/zelscan.conf ]] || ln -s /etc/nginx/sites-available/zelscan.conf /etc/nginx/sites-enabled/zelscan.conf

chown -R "$APP_USER:$APP_USER" "$APP_DIR"
find "$APP_DIR/secrets" -type d -exec chmod 700 {} + 2>/dev/null || true
find "$APP_DIR/secrets" -type f -exec chmod 600 {} + 2>/dev/null || true
find "$APP_DIR" -maxdepth 1 -type f -name '.*token*' -exec chmod 600 {} + 2>/dev/null || true
find "$APP_DIR" -maxdepth 1 -type f \( -name '.lolz_*' -o -name '.turnstile_*' \) -exec chmod 600 {} + 2>/dev/null || true
chmod 700 "$APP_DIR/data/private" 2>/dev/null || true

systemctl daemon-reload
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw --force enable
# Deliberately do not start services: edit placeholders and validate first.
echo 'Installed but not started. Edit /etc/zelscan/zelscan.env and Nginx placeholders, then follow DEPLOY_README.md.'
