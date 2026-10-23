#!/usr/bin/env bash
# Startet den interaktiven EAS-Credentials-Wizard fuer InternetBlocker.
# Navigiere die Menues selbst. Erwartetes Vorgehen:
#  1) "Select an operation" -> Generate/Manage credentials (Neu)
#  2) App ID: Create new App ID (bundler com.meister.internetblocker)
#  3) Distribution Certificate: Create new / Automatic
#  4) Provisioning Profile: Automatic
#  Bei Apple-Terms-Prompts: y (Accept)
set -u
cd /opt/apps/internetblocker
echo "==============================================================="
echo " InternetBlocker - Credential Bootstrap (interaktiv)"
echo " Druecke Enter, wenn du bereit bist..."
echo "==============================================================="
read -r _
clear
npx eas credentials --platform ios
echo ""
echo "=== BOOTSTRAP ENDE ==="
