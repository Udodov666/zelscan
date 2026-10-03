#!/usr/bin/env bash
set -Eeuo pipefail
APP_DIR=${APP_DIR:-/opt/zelscan}
BACKUP_ROOT=${BACKUP_ROOT:-/var/backups/zelscan}
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
DEST="$BACKUP_ROOT/$STAMP"
mkdir -p "$DEST"
chmod 700 "$BACKUP_ROOT" "$DEST"

# SQLite online backup is transactionally consistent and does not alter/remove
# the source DB, WAL or SHM files.
if [[ -f "$APP_DIR/zelscan.db" ]]; then
  sqlite3 "$APP_DIR/zelscan.db" ".timeout 30000" ".backup '$DEST/zelscan.db'"
fi

# Preserve runtime data and existing secret files without deleting originals.
for item in cache data/private logs secrets; do
  [[ -e "$APP_DIR/$item" ]] && rsync -a "$APP_DIR/$item" "$DEST/"
done
find "$APP_DIR" -maxdepth 1 -type f \( -name '.lolz_*' -o -name '.turnstile_*' \) -exec cp -a {} "$DEST/" \;
[[ -f /etc/zelscan/zelscan.env ]] && install -m 600 /etc/zelscan/zelscan.env "$DEST/zelscan.env"
chmod -R go-rwx "$DEST"
tar -C "$BACKUP_ROOT" -czf "$BACKUP_ROOT/$STAMP.tar.gz" "$STAMP"
chmod 600 "$BACKUP_ROOT/$STAMP.tar.gz"

# Удаляем распакованную папку — держим только сжатый архив (экономим место).
rm -rf "$DEST"

# ── Retention: чистим архивы старше RETENTION_DAYS дней (по умолчанию 14) ──────
RETENTION_DAYS=${RETENTION_DAYS:-14}
find "$BACKUP_ROOT" -maxdepth 1 -name '*.tar.gz' -type f -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true
find "$BACKUP_ROOT" -maxdepth 1 -type d -name '20*Z' -mtime +"$RETENTION_DAYS" -exec rm -rf {} + 2>/dev/null || true

printf '%s\n' "$BACKUP_ROOT/$STAMP.tar.gz"
