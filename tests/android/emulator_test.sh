#!/usr/bin/env bash
# Test sur emulateur/telephone branche en adb : installe l'APK DEBUG, la lance, verifie qu'elle ne plante pas et
# que l'interface refuse proprement de se connecter (LaboVpnService.ENGINE_INTEGRATED = false).
# Usage : bash tests/android/emulator_test.sh <chemin-apk>
# Ecrit emulator-report.txt (une ligne par verification) et emulator-screen.png dans le dossier courant.
set -u
APK="${1:-app/build/outputs/apk/debug/app-debug.apk}"
PKG=com.philippo237.labosurf
REPORT=emulator-report.txt
: > "$REPORT"
FAIL=0
say()  { echo "$*" | tee -a "$REPORT"; }
ok()   { say "OK    $*"; }
ko()   { say "ECHEC $*"; FAIL=1; }

adb wait-for-device
adb shell 'while [ "$(getprop sys.boot_completed)" != "1" ]; do sleep 1; done'
say "Appareil : $(adb shell getprop ro.product.model | tr -d '\r') Android $(adb shell getprop ro.build.version.release | tr -d '\r') (API $(adb shell getprop ro.build.version.sdk | tr -d '\r'))"

adb logcat -c
if adb install -r "$APK" 2>&1 | tee -a "$REPORT" | grep -q "Success"; then ok "installation de l'APK"; else ko "installation de l'APK"; fi
adb shell dumpsys package "$PKG" | grep -E "versionCode|versionName" | head -2 | tr -d '\r' | sed 's/^ */INFO  /' | tee -a "$REPORT"

adb shell am start -W -n "$PKG/.MainActivity" | tr -d '\r' | grep -E "Status|Activity|TotalTime" | sed 's/^/INFO  /' | tee -a "$REPORT"
sleep 12   # animation d'ouverture + chargement de la WebView

PID="$(adb shell pidof "$PKG" | tr -d '\r' | awk '{print $1}')"
if [ -n "$PID" ]; then ok "l'application tourne (pid $PID)"; else ko "l'application ne tourne pas"; fi

if adb logcat -d -b crash | grep -q "FATAL EXCEPTION"; then ko "plantage détecté (FATAL EXCEPTION)"; adb logcat -d -b crash | head -30 | tee -a "$REPORT"; else ok "aucun plantage dans logcat"; fi

SOCK="$(adb shell cat /proc/net/unix | tr -d '\r' | grep -o "webview_devtools_remote_${PID}" | head -1)"
if [ -n "$SOCK" ]; then
  adb forward tcp:9222 "localabstract:$SOCK" >/dev/null
  if node tests/android/smoke.mjs 9222 2>&1 | tee -a "$REPORT" | grep -q "^ECHEC"; then FAIL=1; fi
else
  ko "WebView non inspectable (socket devtools introuvable)"
fi

# Aucune boite de dialogue « demande de connexion VPN » ne doit avoir ete ouverte, aucun tunnel ne doit exister
if adb shell dumpsys window | grep -q "com.android.vpndialogs"; then ko "une demande d'autorisation VPN a été affichée sans moteur"; else ok "aucune demande d'autorisation VPN affichée"; fi
if adb shell dumpsys activity services "$PKG" | grep -q "LaboVpnService"; then ko "LaboVpnService actif sans moteur"; else ok "LaboVpnService non démarré"; fi

adb exec-out screencap -p > emulator-screen.png 2>/dev/null
adb logcat -d -b crash | grep -q "FATAL EXCEPTION" && FAIL=1
[ "$FAIL" = "0" ] && say "RESULTAT : test emulateur réussi" || say "RESULTAT : ECHEC du test emulateur"
exit "$FAIL"
