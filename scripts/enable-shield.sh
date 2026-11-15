#!/usr/bin/env bash
# Aktiviert das echte App-Sperren (Screen Time Shield). Erfordert das von Apple
# freigegebene Entitlement com.apple.developer.family-controls im Team.
set -euo pipefail
cd "$(dirname "$0")/.."
ENT="com.apple.developer.family-controls"

python3 - <<'PY'
import json, sys
p = "app.json"
d = json.load(open(p))
e = d["expo"]
ios = e.setdefault("ios", {})
ent = ios.setdefault("entitlements", {})
ent["com.apple.developer.family-controls"] = True
ent["com.apple.security.application-groups"] = ["group.com.meister.blockphone"]
json.dump(d, open(p, "w"), indent=2, ensure_ascii=False)
print("app.json: entitlement gesetzt")
PY

cp shield/DeviceActivityMonitor/DeviceActivityMonitor.swift ios/.targets/DeviceActivityMonitor/ 2>/dev/null || {
  mkdir -p ios/.targets/DeviceActivityMonitor
  cp shield/DeviceActivityMonitor/* ios/.targets/DeviceActivityMonitor/
}
cp shield/AppTarget/ScreenTimeShield.swift ios/Blockphone/
cp shield/AppTarget/ScreenTimeShieldBridge.m ios/Blockphone/
echo "Shield-Target + Bridge kopiert."
echo "Jetzt: npx expo prebuild -p ios --clean && eas build -p ios --profile production"

