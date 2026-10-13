#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fail=0
check_cmd() { if command -v "$1" >/dev/null 2>&1; then printf 'OK   %s: %s\n' "$1" "$(command -v "$1")"; else printf 'FALTA %s\n' "$1"; fail=1; fi; }
check_cmd java
check_cmd git
check_cmd python3
java -version 2>&1 | head -n 1 || true
SDK="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
if [[ -z "$SDK" ]]; then
  echo "FALTA ANDROID_SDK_ROOT/ANDROID_HOME. Instale Android SDK via Android Studio e exporte a variável."
  fail=1
else
  echo "SDK: $SDK"
  for path in "platforms/android-36/android.jar" "ndk/29.0.13113456/source.properties" "cmake/3.31.6/package.xml"; do
    if [[ -e "$SDK/$path" ]]; then echo "OK   $SDK/$path"; else echo "FALTA $SDK/$path"; fail=1; fi
  done
  for tool in cmake ninja; do
    if [[ -x "$SDK/cmake/3.31.6/bin/$tool" ]]; then echo "OK   SDK $tool: $SDK/cmake/3.31.6/bin/$tool";
    elif command -v "$tool" >/dev/null 2>&1; then echo "OK   $tool: $(command -v "$tool")";
    else echo "FALTA $tool (instale o pacote CMake 3.31.6 pelo SDK Manager)"; fail=1; fi
  done
fi
if [[ -d "$ROOT/external/llama.cpp/examples/llama.android/lib" ]]; then echo "OK   fonte nativa Android preparada"; else echo "PENDENTE: execute bash scripts/bootstrap-llama.sh (requer internet e git)."; fi
if [[ "$fail" -ne 0 ]]; then
  echo "Ambiente ainda não está pronto para compilar." >&2
  exit 2
fi
echo "Ambiente básico validado. Isso não equivale a um build aprovado."
