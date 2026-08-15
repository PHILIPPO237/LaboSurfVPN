#!/usr/bin/env bash
set -euo pipefail

LOG_PREFIX="[zivpn-udp-provision]"
ACTION="${FS_PROVISION_ACTION:-upsert}"
AUTH_TOKEN="${FS_PROVISION_ZIVPN_UDP_AUTH:-${FS_PROVISION_PASSWORD:-${FS_PROVISION_LICENSE:-}}}"
CONFIG_FILE="${FS_ZIVPN_UDP_CONFIG_FILE:-/etc/zivpn/config.json}"
PASSWORDS_FILE="${FS_ZIVPN_UDP_PASSWORDS_FILE:-}"
RELOAD_COMMAND="${FS_ZIVPN_UDP_RELOAD_COMMAND:-}"
SYSTEMD_UNIT="${FS_ZIVPN_UDP_SYSTEMD_UNIT:-}"

log() {
  printf '%s %s\n' "$LOG_PREFIX" "$*" >&2
}

fail() {
  log "$*"
  exit 1
}

ensure_token() {
  if [[ -z "$AUTH_TOKEN" ]]; then
    fail "missing auth token (FS_PROVISION_ZIVPN_UDP_AUTH / FS_PROVISION_PASSWORD / FS_PROVISION_LICENSE)"
  fi
}

reload_service() {
  if [[ -n "$RELOAD_COMMAND" ]]; then
    bash -lc "$RELOAD_COMMAND"
    return
  fi
  if [[ -n "$SYSTEMD_UNIT" ]] && command -v systemctl >/dev/null 2>&1; then
    systemctl restart "$SYSTEMD_UNIT"
  fi
}

upsert_password_file() {
  local path="$1"
  mkdir -p "$(dirname "$path")"
  touch "$path"
  if ! grep -Fqx -- "$AUTH_TOKEN" "$path"; then
    printf '%s\n' "$AUTH_TOKEN" >> "$path"
    log "token added to $path"
  else
    log "token already present in $path"
  fi
}

disable_password_file() {
  local path="$1"
  if [[ ! -f "$path" ]]; then
    log "password file missing, nothing to remove: $path"
    return
  fi
  local tmp
  tmp="$(mktemp)"
  grep -Fvx -- "$AUTH_TOKEN" "$path" > "$tmp" || true
  mv "$tmp" "$path"
  log "token removed from $path"
}

update_config_json() {
  local path="$1"
  [[ -f "$path" ]] || fail "config file not found: $path"

  if command -v python3 >/dev/null 2>&1; then
    python3 - "$path" "$AUTH_TOKEN" "$ACTION" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
token = sys.argv[2]
action = sys.argv[3]
data = json.loads(path.read_text(encoding='utf-8'))
auth = data.setdefault('auth', {})
config = auth.get('config')
config_is_list = isinstance(config, list)
if config is None:
    passwords = []
elif config_is_list:
    passwords = config
elif isinstance(config, dict):
    passwords = config.setdefault('passwords', [])
else:
    raise SystemExit('auth.config must be a list or object')
if not isinstance(passwords, list):
    raise SystemExit('auth.config passwords must be a list')
passwords = [str(item) for item in passwords if str(item)]
if action == 'disable':
    passwords = [item for item in passwords if item != token]
else:
    if token not in passwords:
        passwords.append(token)
if config_is_list:
    auth['config'] = passwords
else:
    if not isinstance(config, dict):
        config = {}
    config['passwords'] = passwords
    auth['config'] = config
path.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
PY
    log "config updated: $path"
    return
  fi

  if command -v jq >/dev/null 2>&1; then
    local tmp
    tmp="$(mktemp)"
    if [[ "$ACTION" == "disable" ]]; then
      jq --arg token "$AUTH_TOKEN" '
        .auth = (.auth // {})
        | if (.auth.config | type) == "array" then
            .auth.config = ((.auth.config // []) | map(tostring) | map(select(. != $token)))
          else
            .auth.config = (.auth.config // {})
            | .auth.config.passwords = ((.auth.config.passwords // []) | map(select(. != $token)))
          end
      ' "$path" > "$tmp"
    else
      jq --arg token "$AUTH_TOKEN" '
        .auth = (.auth // {})
        | if (.auth.config | type) == "array" then
            .auth.config = (
              ((.auth.config // []) | map(tostring)) as $items
              | if ($items | index($token)) == null then $items + [$token] else $items end
            )
          else
            .auth.config = (.auth.config // {})
            | .auth.config.passwords = (
                ((.auth.config.passwords // []) | map(tostring)) as $items
                | if ($items | index($token)) == null then $items + [$token] else $items end
              )
          end
      ' "$path" > "$tmp"
    fi
    mv "$tmp" "$path"
    log "config updated with jq: $path"
    return
  fi

  fail "python3 or jq is required to update $path"
}

main() {
  ensure_token

  case "$ACTION" in
    upsert|disable)
      ;;
    *)
      fail "unsupported action: $ACTION"
      ;;
  esac

  if [[ -f "$CONFIG_FILE" ]]; then
    update_config_json "$CONFIG_FILE"
    reload_service
    exit 0
  fi

  if [[ -n "$PASSWORDS_FILE" ]]; then
    if [[ "$ACTION" == "disable" ]]; then
      disable_password_file "$PASSWORDS_FILE"
    else
      upsert_password_file "$PASSWORDS_FILE"
    fi
    reload_service
    exit 0
  fi

  fail "no ZiVPN UDP target found. Create $CONFIG_FILE or set FS_ZIVPN_UDP_PASSWORDS_FILE."
}

main "$@"