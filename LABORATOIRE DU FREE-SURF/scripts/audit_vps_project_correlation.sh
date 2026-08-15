#!/usr/bin/env bash
set -u

ROOT="${1:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
REPORT_DIR="$ROOT/deploy-reports"
mkdir -p "$REPORT_DIR"
STAMP="$(date -u +%Y%m%d_%H%M%S 2>/dev/null || echo audit)"
REPORT="$REPORT_DIR/vps_project_audit_${STAMP}.md"
ENV_FILES=("$ROOT/.env" "$ROOT/.env.production" "$ROOT/.env.staging" "$ROOT/.env.development")

value_of() {
  local key line file value
  for key in "$@"; do
    value="${!key:-}"
    if [ -n "$value" ]; then printf '%s' "$value"; return; fi
    for file in "${ENV_FILES[@]}"; do
      [ -f "$file" ] || continue
      line="$(grep -E "^${key}=" "$file" 2>/dev/null | tail -n 1)"
      [ -n "$line" ] || continue
      value="${line#*=}"
      value="${value%\"}"; value="${value#\"}"
      value="${value%\'}"; value="${value#\'}"
      printf '%s' "$value"
      return
    done
  done
}

has_any() { [ -n "$(value_of "$@")" ]; }
truthy_any() {
  case "$(value_of "$@" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on|enabled) return 0 ;;
    *) return 1 ;;
  esac
}
cmd_any() { local c p; for c in "$@"; do p="$(command -v "$c" 2>/dev/null || true)"; [ -n "$p" ] && { printf '%s' "$p"; return; }; done; }
svc_any() {
  local s out last="missing"
  command -v systemctl >/dev/null 2>&1 || { printf 'unavailable'; return; }
  for s in "$@"; do
    out="$(systemctl is-active "$s" 2>/dev/null || true)"
    case "$out" in
      active|activating|reloading) printf 'active'; return ;;
      inactive|failed|deactivating) last="$out" ;;
    esac
  done
  printf '%s' "$last"
}
port_any() {
  local p
  command -v ss >/dev/null 2>&1 || return 1
  for p in "$@"; do
    [ -n "$p" ] || continue
    ss -lntup 2>/dev/null | grep -Eq ":${p}\\b" && { printf '%s' "$p"; return 0; }
  done
  return 1
}
docker_any() {
  local pattern
  pattern="$1"
  command -v docker >/dev/null 2>&1 || return 1
  docker ps --format '{{.Names}}' 2>/dev/null | grep -Ei "$pattern" | paste -sd ',' -
}
status_of() {
  local installed="$1" configured="$2" mode="${3:-normal}"
  [ "$mode" = "info" ] && { printf 'INFO'; return; }
  [ "$installed" = "yes" ] && [ "$configured" = "yes" ] && { printf 'OK'; return; }
  [ "$installed" = "yes" ] || [ "$configured" = "yes" ] && { printf 'PARTIAL'; return; }
  printf 'MANQUANT'
}

append_tool() {
  local label="$1" status="$2" installed="$3" configured="$4" ports="$5" options="$6" details="$7" recos="$8"
  printf '| %s | %s | %s | %s | %s | %s |\n' "$label" "$status" "$installed" "$configured" "$ports" "$options" >> "$REPORT"
  {
    printf '\n## %s\n\n' "$label"
    printf -- '- Statut : `%s`\n' "$status"
    printf -- '- Details : %s\n' "$details"
    printf -- '- Options projet : %s\n' "$options"
    printf -- '- Actions recommandees : %s\n' "$recos"
  } >> "$REPORT"
}

backend="$(value_of FS_PANEL_BACKEND PANEL_BACKEND | tr '[:upper:]' '[:lower:]')"
ssh_port="$(value_of FS_SSH_PORT SSH_PORT)"; [ -n "$ssh_port" ] || ssh_port=22
slowdns_port="$(value_of FS_SLOWDNS_PORT SLOWDNS_PORT)"; [ -n "$slowdns_port" ] || slowdns_port=53
hysteria_port="$(value_of FS_HYSTERIA_PORT HYSTERIA_PORT)"; [ -n "$hysteria_port" ] || hysteria_port=8443
udpgw_port="$(value_of FS_UDPGW_PORT UDPGW_PORT)"; [ -n "$udpgw_port" ] || udpgw_port=7300
zivpn_port="$(value_of FS_ZIVPN_UDP_PUBLIC_PORT ZIVPN_UDP_PUBLIC_PORT FS_ZIVPN_UDP_PORT ZIVPN_UDP_PORT)"; [ -n "$zivpn_port" ] || zivpn_port=5667

echo '# Audit - Correlation VPS / projet' > "$REPORT"
echo >> "$REPORT"
echo "**Date UTC** : $(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || echo unknown)" >> "$REPORT"
echo "**Projet** : \`$ROOT\`" >> "$REPORT"
echo >> "$REPORT"
echo '## Matrice de correlation' >> "$REPORT"
echo >> "$REPORT"
echo '| Outil VPS | Statut | Installe | Configure | Ports | Options projet |' >> "$REPORT"
echo '| --- | --- | --- | --- | --- | --- |' >> "$REPORT"

installed=no; configured=no; ports=-
[ -n "$(cmd_any remnawave)" ] && installed=yes
[ "$(svc_any remnawave)" = active ] && installed=yes
[ -n "$(docker_any 'remnawave|remna' 2>/dev/null || true)" ] && installed=yes
[[ "$backend" =~ ^(remnawave|remna)$ ]] && has_any FS_REMNAWAVE_URL REMNAWAVE_BASE_URL && has_any FS_REMNAWAVE_API_KEY REMNAWAVE_API_KEY && configured=yes
append_tool 'Remnawave' "$(status_of "$installed" "$configured")" "$installed" "$configured" "$ports" 'Synchroniser Panel, health panel, correlation scanner/panel' "backend=$backend; cmd=$(cmd_any remnawave); svc=$(svc_any remnawave)" 'Verifier backend, URL/API key et service ou conteneur Remnawave.'

installed=no; configured=no; ports=-
checker="$(value_of XRAY_CHECKER_PATH)"
[ -n "$(cmd_any xray-checker "$checker")" ] && installed=yes && configured=yes
append_tool 'xray-checker' "$(status_of "$installed" "$configured")" "$installed" "$configured" "$ports" 'Scanner start_xray, pipeline scan -> xray -> configs' "path=$(cmd_any xray-checker "$checker")" 'Installer xray-checker ou definir XRAY_CHECKER_PATH.'

installed=no; configured=no; ports=no
[ "$(svc_any ssh sshd dropbear)" = active ] && installed=yes
[ -n "$(cmd_any sshd dropbear)" ] && installed=yes
port_any "$ssh_port" "$(value_of FS_DROPBEAR_PORT DROPBEAR_PORT)" >/dev/null 2>&1 && ports=yes && installed=yes
(has_any FS_SSH_DEFAULT_USER SSH_DEFAULT_USER || has_any FS_DROPBEAR_USER DROPBEAR_USER) && configured=yes
append_tool 'SSH / Dropbear' "$(status_of "$installed" "$configured")" "$installed" "$configured" "$ports" 'SSH/SLOWDNS + V2RAY, transport backends, provisioning' "svc=$(svc_any ssh sshd dropbear); ssh_port=$ssh_port" 'Verifier sshd/dropbear, ports ouverts et user par defaut du projet.'

installed=no; configured=no; ports=no
[ -n "$(cmd_any dnstt-server dnstt-client slowdns)" ] && installed=yes
[ "$(svc_any dnstt slowdns)" = active ] && installed=yes
port_any "$slowdns_port" >/dev/null 2>&1 && ports=yes && installed=yes
has_any FS_SLOWDNS_DOMAIN SLOWDNS_DOMAIN && has_any FS_SLOWDNS_PUBKEY SLOWDNS_PUBKEY && configured=yes
append_tool 'SlowDNS / DNSTT' "$(status_of "$installed" "$configured")" "$installed" "$configured" "$ports" 'SLOWDNS, SSH/SLOWDNS + V2RAY, provisioning' "cmd=$(cmd_any dnstt-server dnstt-client slowdns); port=$slowdns_port" 'Verifier domaine, pubkey, ns host et service SlowDNS/DNSTT.'

installed=no; configured=no; ports=no
[ -n "$(cmd_any hysteria hysteria2)" ] && installed=yes
[ "$(svc_any hysteria hysteria-server)" = active ] && installed=yes
port_any "$hysteria_port" >/dev/null 2>&1 && ports=yes && installed=yes
has_any FS_HYSTERIA_HOST HYSTERIA_HOST FS_HYSTERIA_IP HYSTERIA_IP && has_any FS_HYSTERIA_PASS HYSTERIA_PASS && has_any FS_HYSTERIA_SNI HYSTERIA_SNI && configured=yes
append_tool 'Hysteria 2' "$(status_of "$installed" "$configured")" "$installed" "$configured" "$ports" 'HYSTERIA, transport backends, provisioning' "cmd=$(cmd_any hysteria hysteria2); port=$hysteria_port" 'Verifier host, port, pass et sni Hysteria.'

installed=no; configured=no; ports=no
[ -n "$(cmd_any badvpn-udpgw udpgw)" ] && installed=yes
[ "$(svc_any badvpn-udpgw udpgw)" = active ] && installed=yes
port_any "$udpgw_port" >/dev/null 2>&1 && ports=yes && installed=yes
truthy_any FS_UDPGW_ENABLED UDPGW_ENABLED && configured=yes
append_tool 'UDPGW / UDP Custom' "$(status_of "$installed" "$configured")" "$installed" "$configured" "$ports" 'UDP CUSTOM, transport backends' "cmd=$(cmd_any badvpn-udpgw udpgw); port=$udpgw_port" 'Verifier daemon UDPGW et activer FS_UDPGW_ENABLED si necessaire.'

ssh_ready=no; proxy_ready=no
([ "$(svc_any ssh sshd)" = active ] || port_any "$ssh_port" >/dev/null 2>&1) && ssh_ready=yes
(truthy_any FS_UDPGW_ENABLED UDPGW_ENABLED || port_any "$udpgw_port" >/dev/null 2>&1) && proxy_ready=yes
append_tool 'UDP Request' 'INFO' '-' "$([ "$ssh_ready" = yes ] || [ "$proxy_ready" = yes ] && echo yes || echo no)" "$([ "$ssh_ready" = yes ] || [ "$proxy_ready" = yes ] && echo yes || echo no)" 'UDP REQUEST' "ssh_ready=$ssh_ready; proxy_ready=$proxy_ready" 'Option composite : verifier surtout SSH et la chaine proxy/UDPGW.'

installed=no; configured=no; ports=no
[ -n "$(cmd_any zivpn)" ] && installed=yes
[ "$(svc_any zivpn "$(value_of FS_ZIVPN_UDP_SYSTEMD_UNIT)")" = active ] && installed=yes
port_any "$zivpn_port" >/dev/null 2>&1 && ports=yes && installed=yes
[ -f "$(value_of FS_ZIVPN_UDP_CONFIG_FILE ZIVPN_UDP_CONFIG_FILE)" ] && installed=yes
truthy_any FS_ZIVPN_UDP_ENABLED ZIVPN_UDP_ENABLED && has_any FS_ZIVPN_UDP_HOST ZIVPN_UDP_HOST && has_any FS_ZIVPN_UDP_SNI ZIVPN_UDP_SNI && configured=yes
if truthy_any FS_ZIVPN_UDP_PROVISION_ENABLED ZIVPN_UDP_PROVISION_ENABLED && ! has_any FS_ZIVPN_UDP_PROVISION_UPSERT_COMMAND ZIVPN_UDP_PROVISION_UPSERT_COMMAND; then configured=no; fi
append_tool 'ZiVPN UDP' "$(status_of "$installed" "$configured")" "$installed" "$configured" "$ports" 'SPECIAL ZIVPN, transport backends, provisioning' "cmd=$(cmd_any zivpn); port=$zivpn_port; cfg=$(value_of FS_ZIVPN_UDP_CONFIG_FILE ZIVPN_UDP_CONFIG_FILE)" 'Verifier host, sni, port, service/fichier cible et commande de provisioning ZiVPN.'

echo >> "$REPORT"
echo '## Interpretation' >> "$REPORT"
echo >> "$REPORT"
echo '- `OK` : outil present et lien projet coherent.' >> "$REPORT"
echo '- `PARTIAL` : outil ou config present, mais correlation incomplete.' >> "$REPORT"
echo '- `MANQUANT` : aucune preuve exploitable de liaison.' >> "$REPORT"
echo '- `INFO` : fonctionnalite composite sans daemon dedie obligatoire.' >> "$REPORT"

echo "Audit termine : $REPORT"
