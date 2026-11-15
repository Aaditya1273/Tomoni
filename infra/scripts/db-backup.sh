#!/usr/bin/env bash
# Encrypted Postgres backups and a restore drill (BUILD_PROMPT §8; RUNBOOK "Backups").
#
#   db-backup.sh backup  [db]          → backups/<db>-<utc>.dump.enc
#   db-backup.sh restore <file> <db>   → a new database <db> (refuses to overwrite one)
#   db-backup.sh drill   [db]          → backup, restore into <db>_drill, verify, drop
#
# Needs DATABASE_OWNER_URL (any database on the cluster) and TOMONI_BACKUP_KEY (32+ chars; keep it
# apart from the backups). Dumps are pg_dump custom format, then AES-256 (openssl, PBKDF2). PHI
# columns are already field-encrypted inside the dump; this is the second layer, at rest.
set -euo pipefail
cd "$(dirname "$0")/../.."
[[ -f .env ]] && set -a && . ./.env && set +a
: "${DATABASE_OWNER_URL:?set DATABASE_OWNER_URL}"
: "${TOMONI_BACKUP_KEY:?set TOMONI_BACKUP_KEY (32+ chars)}"
(( ${#TOMONI_BACKUP_KEY} >= 32 )) || { echo "TOMONI_BACKUP_KEY must be 32+ chars" >&2; exit 1; }

url_for() { echo "${DATABASE_OWNER_URL%/*}/$1"; }
# Client tools must match the server's major version. PGTOOLS can run them from the server image:
#   PGTOOLS="docker run --rm -i --network host postgres:18.3"
pg() { ${PGTOOLS:-} "$@"; }
enc() { openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:TOMONI_BACKUP_KEY "$@"; }

backup() {
  local db=$1 out
  mkdir -p backups && chmod 700 backups
  out="backups/${db}-$(date -u +%Y%m%dT%H%M%SZ).dump.enc"
  pg pg_dump --format=custom --no-password "$(url_for "$db")" | enc -out "$out"
  chmod 600 "$out"
  echo "$out"
}

restore() {
  local file=$1 db=$2
  if pg psql -tA "$(url_for postgres)" -c "SELECT 1 FROM pg_database WHERE datname = '$db'" | grep -q 1; then
    echo "database $db exists; restore only into a new database" >&2
    exit 1
  fi
  pg psql -q "$(url_for postgres)" -c "CREATE DATABASE \"$db\""
  enc -d -in "$file" | pg pg_restore --exit-on-error --no-password -d "$(url_for "$db")"
}

# Every table's exact row count, so source and restore can be compared line by line.
counts() {
  pg psql -tA "$(url_for "$1")" -c "
    SELECT string_agg(format('%s.%s=%s', schemaname, relname,
           (xpath('/row/n/text()', query_to_xml(format('SELECT count(*) AS n FROM %I.%I', schemaname, relname), false, true, '')))[1]::text),
           E'\n' ORDER BY schemaname, relname)
      FROM pg_stat_user_tables WHERE schemaname IN ('auth', 'care', 'research', 'audit', 'ops')"
}

drill() {
  local db=$1 target="${1}_drill" file start
  [[ $db =~ ^[a-z0-9_]+$ ]] || { echo "bad database name" >&2; exit 1; }
  start=$(date +%s)
  # Seal pending audit rows first, so the dump holds a complete chain to verify.
  pg psql -q "$(url_for "$db")" -c "SELECT audit.seal(100000)" >/dev/null
  file=$(backup "$db")
  restore "$file" "$target"
  DRILL_DB=$target
  trap 'pg psql -q "$(url_for postgres)" -c "DROP DATABASE IF EXISTS \"$DRILL_DB\""' EXIT
  diff <(counts "$db") <(counts "$target") >/dev/null || { echo "row counts differ after restore" >&2; exit 1; }
  local broken
  broken=$(pg psql -tA "$(url_for "$target")" -c "SELECT audit.verify()")
  [[ -z $broken ]] || { echo "audit chain broken at $broken after restore" >&2; exit 1; }
  echo "drill ok: $db → $file → $target; $(counts "$target" | wc -l) tables match, audit chain intact, $(( $(date +%s) - start )) s"
}

case "${1:-}" in
  backup) backup "${2:-tomoni}" ;;
  restore) restore "${2:?file}" "${3:?target database}" ;;
  drill) drill "${2:-tomoni}" ;;
  *) sed -n '2,8p' "$0"; exit 2 ;;
esac
