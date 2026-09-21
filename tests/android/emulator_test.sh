#!/usr/bin/env bash
# Test sur emulateur/telephone branche en adb : installe l'APK DEBUG, la lance, et valide la chaine Android REELLE :
#   - l'application demarre sans planter ;
#   - le moteur UDP natif refuse proprement (protocole non supporte, lien invalide, mot de passe refuse) ;
#   - connexion a un FAUX serveur UDP LABOSURF local (tests/udp/mock_server.py, joignable depuis l'emulateur en 10.0.2.2) :
#     handshake, ClientID annonce (l'emulateur est derriere un NAT), verification du chemin, VpnService + TUN reels, etat « on » ;
#   - un ping depuis l'emulateur traverse le TUN puis le tunnel ; deconnexion propre.
# Le faux serveur ne transporte RIEN vers Internet : ce test valide le CLIENT Android, pas un VPN de bout en bout.
# Usage : bash tests/android/emulator_test.sh <chemin-apk>
# Ecrit emulator-report.txt (une ligne par verification) et emulator-screen.png dans le dossier courant.
set -u
APK="${1:-app/build/outputs/apk/debug/app-debug.apk}"
PKG=com.philippo237.labosurf
REPORT=emulator-report.txt
MOCKLOG=mock-server.log
MOCKPW="pw-$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"
: > "$REPORT"; : > "$MOCKLOG"
FAIL=0
A() { timeout 90 adb "$@"; }
say()  { echo "$*" | tee -a "$REPORT"; }
ok()   { say "OK    $*"; }
ko()   { say "ECHEC $*"; FAIL=1; }
alive() { [ "$(timeout 20 adb get-state 2>/dev/null)" = "device" ] || { ko "emulateur hors ligne avant la phase $1 (voir logcat.txt)"; return 1; }; }
smoke() { alive "$1" || return; timeout 150 node tests/android/smoke.mjs 9222 "$@" > smoke.out 2>&1; RC=$?; tee -a "$REPORT" < smoke.out; grep -q "^ECHEC" smoke.out && FAIL=1; [ "$RC" = "124" ] && ko "phase $1 : delai depasse (150 s)"; }

A wait-for-device
A shell 'while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 1; done'
say "Appareil : $(A shell getprop ro.product.model | tr -d '\r') Android $(A shell getprop ro.build.version.release | tr -d '\r') (API $(A shell getprop ro.build.version.sdk | tr -d '\r'))"

adb logcat -c
adb logcat -v time > logcat.txt 2>&1 &
LOGPID=$!
if A install -r "$APK" 2>&1 | tee -a "$REPORT" | grep -q "Success"; then ok "installation de l'APK"; else ko "installation de l'APK"; fi
A shell dumpsys package "$PKG" | grep -E "versionCode|versionName" | head -2 | tr -d '\r' | sed 's/^ */INFO  /' | tee -a "$REPORT"

# Consentement VPN accorde par adb (sinon Android affiche la boite de dialogue systeme, que personne ne peut valider en CI)
A shell appops set "$PKG" ACTIVATE_VPN allow

# Faux serveur UDP LABOSURF sur la machine hote (l'emulateur l'atteint en 10.0.2.2)
python3 tests/udp/mock_server.py --port 5667 --password "$MOCKPW" --log "$MOCKLOG" > /dev/null 2>&1 &
MOCKPID=$!
sleep 1
kill -0 "$MOCKPID" 2>/dev/null && ok "faux serveur UDP de test demarre" || ko "faux serveur UDP de test non demarre"

A shell am start -W -n "$PKG/.MainActivity" | tr -d '\r' | grep -E "Status|Activity|TotalTime" | sed 's/^/INFO  /' | tee -a "$REPORT"
sleep 12   # animation d'ouverture + chargement de la WebView

PID="$(A shell pidof "$PKG" | tr -d '\r' | awk '{print $1}')"
if [ -n "$PID" ]; then ok "l'application tourne (pid $PID)"; else ko "l'application ne tourne pas"; fi
if A logcat -d -b crash | grep -q "FATAL EXCEPTION"; then ko "plantage detecte (FATAL EXCEPTION)"; A logcat -d -b crash | head -30 | tee -a "$REPORT"; else ok "aucun plantage dans logcat"; fi

SOCK="$(A shell cat /proc/net/unix | tr -d '\r' | grep -o "webview_devtools_remote_${PID}" | head -1)"
if [ -n "$SOCK" ]; then
  A forward tcp:9222 "localabstract:$SOCK" >/dev/null
  smoke base
  smoke badauth 10.0.2.2 5667
  smoke connect 10.0.2.2 5667 "$MOCKPW"

  # Etat systeme : un reseau VPN existe reellement
  if A shell dumpsys connectivity | tr -d '\r' | grep -qiE "type: VPN|VPN\[|VpnTransportInfo|transports: \[ VPN \]"; then ok "Android connait un reseau VPN actif"; else ko "aucun reseau VPN actif cote systeme"; fi
  if A shell dumpsys activity services "$PKG" | grep -q "LaboVpnService"; then ok "LaboVpnService est demarre (service au premier plan)"; else ko "LaboVpnService absent"; fi

  # Trafic reel du TELEPHONE a travers le TUN puis le tunnel (le faux serveur repond aux ICMP)
  PING="$(timeout 40 A shell "ping -c 3 -W 3 -w 15 1.1.1.1" 2>&1 | tr -d "
")"
  echo "$PING" | tail -4 | sed 's/^/INFO  ping : /' | tee -a "$REPORT"
  if echo "$PING" | grep -qE "[1-3] received"; then ok "ping emis par l'emulateur : reponse via le TUN et le tunnel UDP"; else ko "ping : aucune reponse a travers le tunnel"; fi
  sleep 2
  ICMP=$(grep -c "ICMP echo" "$MOCKLOG" || true); DNS=$(grep -c "DNS répondu" "$MOCKLOG" || true)
  [ "${ICMP:-0}" -ge 1 ] && ok "le serveur a recu des ICMP du tunnel ($ICMP)" || ko "le serveur n'a recu aucun ICMP"
  [ "${DNS:-0}" -ge 1 ] && ok "le serveur a recu la requete DNS de verification du chemin ($DNS)" || ko "le serveur n'a pas recu la requete DNS de verification"
  grep -q "ClientID incorrect" "$MOCKLOG" && ko "le serveur a rejete des paquets (ClientID incorrect : NAT mal gere)" || ok "aucun paquet rejete pour ClientID (NAT gere)"

  smoke disconnect
  sleep 2
  if A shell dumpsys activity services "$PKG" | grep -q "LaboVpnService"; then ko "LaboVpnService toujours actif apres deconnexion"; else ok "LaboVpnService arrete apres deconnexion"; fi
else
  ko "WebView non inspectable (socket devtools introuvable)"
fi

if A shell dumpsys window | grep -q "com.android.vpndialogs"; then ko "une boite de dialogue d'autorisation VPN est restee affichee"; else ok "aucune boite de dialogue d'autorisation VPN en attente"; fi
kill "$MOCKPID" 2>/dev/null; wait "$MOCKPID" 2>/dev/null
sleep 1; kill "$LOGPID" 2>/dev/null
{ echo "--- logcat (lignes utiles)"; grep -E "AndroidRuntime|FATAL|labosurf|LaboSurf|VpnService|Vpn |ActivityManager.*labosurf" logcat.txt | tail -60; } | tee -a "$REPORT" >/dev/null
A exec-out screencap -p > emulator-screen.png 2>/dev/null
A logcat -d -b crash | grep -q "FATAL EXCEPTION" && FAIL=1
{ echo "--- journal du faux serveur (dernieres lignes)"; tail -12 "$MOCKLOG"; } | tee -a "$REPORT" >/dev/null
[ "$FAIL" = "0" ] && say "RESULTAT : test emulateur reussi" || say "RESULTAT : ECHEC du test emulateur"
exit "$FAIL"
