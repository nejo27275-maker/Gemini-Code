#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APK="$ROOT/app/build/outputs/apk/debug/app-debug.apk"
command -v adb >/dev/null 2>&1 || { echo "ERRO: adb não encontrado. Instale Android platform-tools." >&2; exit 2; }
[[ -f "$APK" ]] || { echo "ERRO: APK ainda não existe. Execute bash scripts/build-apk.sh primeiro." >&2; exit 2; }
DEVICES="$(adb devices | awk 'NR>1 && $2=="device" {print $1}')"
[[ -n "$DEVICES" ]] || { echo "ERRO: nenhum dispositivo autorizado conectado. Ative Depuração USB e autorize o computador." >&2; exit 2; }
adb install -r "$APK"
echo "Instalação solicitada ao adb. Confirme o resultado acima e abra ‘Minha IA’ no aparelho."
