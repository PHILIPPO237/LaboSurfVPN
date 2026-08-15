#!/usr/bin/env bash
set -euo pipefail

REMOTE_PATH="${REMOTE_PATH:-/opt/LABORATOIRE DU FREE-SURF}"
ARCHIVE_PATH="${ARCHIVE_PATH:-/tmp/lfs_deploy.zip}"
APP_PORT="${APP_PORT:-8000}"
APP_HOST="${APP_HOST:-127.0.0.1}"
APP_LINK_PATH="${APP_LINK_PATH:-/opt/laboratoire-du-free-surf}"
SERVICE_NAME="${SERVICE_NAME:-laboratoire-free-surf}"
SERVICE_USER="${SERVICE_USER:-root}"
FS_ENV="${FS_ENV:-production}"
PUBLIC_URL="${PUBLIC_URL:-}"
ADMIN_URL="${ADMIN_URL:-}"
INSTALL_REQUIREMENTS="${INSTALL_REQUIREMENTS:-1}"
HEALTH_RETRIES="${HEALTH_RETRIES:-20}"
HEALTH_DELAY="${HEALTH_DELAY:-2}"
USE_SYSTEMD="${USE_SYSTEMD:-1}"
SYSTEMD_UNIT_PATH="${SYSTEMD_UNIT_PATH:-/etc/systemd/system/${SERVICE_NAME}.service}"
RUNTIME_ENV_PATH="${RUNTIME_ENV_PATH:-${APP_LINK_PATH}/.env.runtime}"
PERSISTENT_STATIC_DIRS="${PERSISTENT_STATIC_DIRS:-ads avatars}"
OLD_MANIFEST="${REMOTE_PATH}/.deploy_root_files.txt"

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Commande requise absente sur le VPS: $1" >&2
    exit 1
  }
}

systemd_available() {
  [ "$USE_SYSTEMD" = "1" ] || return 1
  command -v systemctl >/dev/null 2>&1 || return 1
  systemctl list-unit-files >/dev/null 2>&1
}

build_root_manifest() {
  local source_root="$1"
  local manifest_path="$2"
  find "$source_root" -mindepth 1 -maxdepth 1 -type f ! -name '.deploy_root_files.generated.txt' -printf '%f\n' | LC_ALL=C sort > "$manifest_path"
}

sync_replace_dir() {
  local source_dir="$1"
  local destination_dir="$2"
  if [ ! -d "$source_dir" ]; then
    rm -rf "$destination_dir"
    return
  fi
  rm -rf "$destination_dir"
  mkdir -p "$(dirname "$destination_dir")"
  cp -a "$source_dir" "$destination_dir"
}

sync_dir_with_preserved_children() {
  local source_dir="$1"
  local destination_dir="$2"
  local preserve_list="$3"
  local name source_entry destination_entry

  mkdir -p "$destination_dir"
  if [ ! -d "$source_dir" ]; then
    return
  fi

  find "$destination_dir" -mindepth 1 -maxdepth 1 -printf '%f\n' | while IFS= read -r name; do
    case " $preserve_list " in
      *" $name "*) continue ;;
    esac
    rm -rf "$destination_dir/$name"
  done

  find "$source_dir" -mindepth 1 -maxdepth 1 -printf '%f\n' | while IFS= read -r name; do
    source_entry="$source_dir/$name"
    destination_entry="$destination_dir/$name"
    if [ -d "$source_entry" ]; then
      case " $preserve_list " in
        *" $name "*)
          mkdir -p "$destination_entry"
          cp -a "$source_entry/." "$destination_entry/"
          ;;
        *)
          rm -rf "$destination_entry"
          cp -a "$source_entry" "$destination_dir/"
          ;;
      esac
    else
      rm -f "$destination_entry"
      cp -a "$source_entry" "$destination_entry"
    fi
  done
}

write_runtime_env_file() {
  if [ -f "$RUNTIME_ENV_PATH" ]; then
    return
  fi
  mkdir -p "$(dirname "$RUNTIME_ENV_PATH")"
  cat > "$RUNTIME_ENV_PATH" <<EOF
# Optional runtime overrides for $SERVICE_NAME.
# Example:
# FS_ENV=production
EOF
}

install_systemd_unit() {
  cat > "$SYSTEMD_UNIT_PATH" <<EOF
[Unit]
Description=LABORATOIRE DU FREE-SURF
After=network.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$APP_LINK_PATH
Environment=PYTHONPATH=$APP_LINK_PATH
Environment=PYTHONDONTWRITEBYTECODE=1
Environment=FS_ENV=$FS_ENV
EnvironmentFile=-$RUNTIME_ENV_PATH
ExecStart=$APP_LINK_PATH/.venv/bin/python -m uvicorn main:app --host $APP_HOST --port $APP_PORT --proxy-headers
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable "$SERVICE_NAME" >/dev/null 2>&1 || true
  systemctl restart "$SERVICE_NAME"
}

restart_with_nohup() {
  cd "$APP_LINK_PATH"
  export PYTHONPATH="$APP_LINK_PATH"
  export PYTHONDONTWRITEBYTECODE=1
  export FS_ENV="$FS_ENV"

  if [ -f uvicorn.pid ]; then
    old_pid="$(cat uvicorn.pid 2>/dev/null || true)"
    if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
      kill "$old_pid" 2>/dev/null || true
    fi
  fi

  pkill -f 'uvicorn main:app' || true
  sleep 1
  nohup .venv/bin/python -m uvicorn main:app --host "$APP_HOST" --port "$APP_PORT" --proxy-headers > uvicorn.log 2>&1 &
  printf '%s' "$!" > uvicorn.pid
}

show_recent_logs() {
  if systemd_available; then
    journalctl -u "$SERVICE_NAME" -n 40 --no-pager || true
  else
    tail -n 40 "$APP_LINK_PATH/uvicorn.log" || true
  fi
}

for cmd in python3 curl pkill find sort; do
  require_cmd "$cmd"
done

TMP_DIR="$(mktemp -d /tmp/lfs_deploy_XXXXXX)"
cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$REMOTE_PATH"
ln -sfn "$REMOTE_PATH" "$APP_LINK_PATH"

if command -v unzip >/dev/null 2>&1; then
  unzip -o "$ARCHIVE_PATH" -d "$TMP_DIR" >/dev/null
else
  python3 - "$ARCHIVE_PATH" "$TMP_DIR" <<'PY'
import os
import shutil
import sys
import zipfile

archive_path, target_dir = sys.argv[1], sys.argv[2]
target_dir = os.path.abspath(target_dir)

with zipfile.ZipFile(archive_path) as zf:
    for info in zf.infolist():
        name = info.filename.replace('\\', '/').lstrip('/')
        if not name:
            continue
        destination = os.path.abspath(os.path.normpath(os.path.join(target_dir, name)))
        if destination != target_dir and not destination.startswith(target_dir + os.sep):
            raise RuntimeError(f'Unsafe archive entry: {info.filename}')
        if info.is_dir() or name.endswith('/'):
            os.makedirs(destination, exist_ok=True)
            continue
        os.makedirs(os.path.dirname(destination), exist_ok=True)
        with zf.open(info, 'r') as src, open(destination, 'wb') as dst:
            shutil.copyfileobj(src, dst)
PY
fi
rm -f "$ARCHIVE_PATH"

sync_replace_dir "$TMP_DIR/app" "$REMOTE_PATH/app"
sync_dir_with_preserved_children "$TMP_DIR/static" "$REMOTE_PATH/static" "$PERSISTENT_STATIC_DIRS"
sync_replace_dir "$TMP_DIR/templates" "$REMOTE_PATH/templates"
sync_replace_dir "$TMP_DIR/scripts" "$REMOTE_PATH/scripts"
sync_replace_dir "$TMP_DIR/docs" "$REMOTE_PATH/docs"

GENERATED_MANIFEST="$TMP_DIR/.deploy_root_files.generated.txt"
build_root_manifest "$TMP_DIR" "$GENERATED_MANIFEST"

if [ -f "$OLD_MANIFEST" ]; then
  while IFS= read -r rel || [ -n "$rel" ]; do
    [ -n "$rel" ] || continue
    if ! grep -Fxq "$rel" "$GENERATED_MANIFEST"; then
      rm -f "$REMOTE_PATH/$rel"
    fi
  done < "$OLD_MANIFEST"
fi

while IFS= read -r rel || [ -n "$rel" ]; do
  [ -n "$rel" ] || continue
  cp -f "$TMP_DIR/$rel" "$REMOTE_PATH/$rel"
done < "$GENERATED_MANIFEST"
cp -f "$GENERATED_MANIFEST" "$OLD_MANIFEST"

if [ -d "$REMOTE_PATH/scripts" ]; then
  chmod +x "$REMOTE_PATH"/scripts/*.sh 2>/dev/null || true
fi

if [ ! -x "$APP_LINK_PATH/.venv/bin/python" ]; then
  python3 -m venv "$APP_LINK_PATH/.venv"
fi

cd "$APP_LINK_PATH"
. .venv/bin/activate

SHOULD_INSTALL=0
REQ_HASH=""
if [ "$INSTALL_REQUIREMENTS" = "1" ] && [ -f requirements.txt ]; then
  if ! command -v sha256sum >/dev/null 2>&1; then
    SHOULD_INSTALL=1
  else
    REQ_HASH="$(sha256sum requirements.txt | awk '{print $1}')"
    PREV_HASH="$(cat .requirements.sha256 2>/dev/null || true)"
    if [ "$REQ_HASH" != "$PREV_HASH" ]; then
      SHOULD_INSTALL=1
    fi
  fi
fi

if [ "$SHOULD_INSTALL" = "1" ]; then
  python -m pip install --upgrade pip
  python -m pip install -r requirements.txt
  if [ -n "$REQ_HASH" ]; then
    printf '%s' "$REQ_HASH" > .requirements.sha256
  fi
fi

write_runtime_env_file
pkill -f 'uvicorn main:app' || true
rm -f "$APP_LINK_PATH/uvicorn.pid"

if systemd_available; then
  install_systemd_unit
else
  restart_with_nohup
fi

READY=0
for attempt in $(seq 1 "$HEALTH_RETRIES"); do
  if curl -fsS "http://127.0.0.1:$APP_PORT/health" >/dev/null 2>&1; then
    READY=1
    break
  fi
  sleep "$HEALTH_DELAY"
done

if [ "$READY" != "1" ]; then
  echo "--- ECHEC HEALTHCHECK LOCAL ---"
  show_recent_logs
  exit 1
fi

echo "--- DEPLOIEMENT OK ---"
echo "APP_LINK_PATH=$APP_LINK_PATH"
echo "FS_ENV=$FS_ENV"
echo "APP_HOST=$APP_HOST"
echo "APP_PORT=$APP_PORT"

if systemd_available; then
  echo "--- SYSTEMD ---"
  systemctl is-enabled "$SERVICE_NAME" || true
  systemctl is-active "$SERVICE_NAME" || true
else
  echo "--- NOHUP PID ---"
  cat "$APP_LINK_PATH/uvicorn.pid" 2>/dev/null || true
fi

echo "--- PORT $APP_PORT ---"
if command -v ss >/dev/null 2>&1; then
  ss -tulpen | grep "$APP_PORT" || true
else
  netstat -tulpen 2>/dev/null | grep "$APP_PORT" || true
fi

echo "--- DERNIERES LIGNES LOG ---"
show_recent_logs

if [ -n "$PUBLIC_URL" ]; then
  echo "--- APPLICATION WEB / APK ---"
  echo "$PUBLIC_URL"
  if curl -kLfsS -o /dev/null "$PUBLIC_URL"; then
    echo "WEB CHECK: OK"
  else
    echo "WEB CHECK: WARNING"
  fi
fi

if [ -n "$ADMIN_URL" ]; then
  echo "--- PANEL TECHNIQUE / REMNAWAVE ---"
  echo "$ADMIN_URL"
  if curl -kLfsS -o /dev/null "$ADMIN_URL"; then
    echo "ADMIN CHECK: OK"
  else
    echo "ADMIN CHECK: WARNING"
  fi
fi

exit 0
