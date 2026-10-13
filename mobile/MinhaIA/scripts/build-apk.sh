#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
GRADLE_VERSION="9.6.0"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/minhaia"
GRADLE_HOME_LOCAL="$CACHE/gradle-$GRADLE_VERSION"

"$ROOT/scripts/check-environment.sh"
if [[ ! -d "$ROOT/external/llama.cpp/examples/llama.android/lib" ]]; then
  "$ROOT/scripts/bootstrap-llama.sh"
fi

GRADLE_CMD=""
if command -v gradle >/dev/null 2>&1; then
  INSTALLED_GRADLE_VERSION="$(gradle --version 2>/dev/null | awk '$1 == "Gradle" { print $2; exit}')"
  if [[ "$INSTALLED_GRADLE_VERSION" == "$GRADLE_VERSION" ]]; then
    GRADLE_CMD="$(command -v gradle)"
  else
    echo "Gradle do sistema: ${INSTALLED_GRADLE_VERSION:-versão desconhecida}; será usada a versão fixada $GRADLE_VERSION."
  fi
fi
if [[ -z "$GRADLE_CMD" ]]; then
  GRADLE_CMD="$GRADLE_HOME_LOCAL/bin/gradle"
  if [[ ! -x "$GRADLE_CMD" ]]; then
    command -v curl >/dev/null 2>&1 || { echo "ERRO: instale Gradle 9.6.0 ou curl para baixar a distribuição oficial." >&2; exit 2; }
    command -v sha256sum >/dev/null 2>&1 || { echo "ERRO: sha256sum é necessário para validar a distribuição do Gradle." >&2; exit 2; }
    mkdir -p "$CACHE"
    TMP="$CACHE/gradle-$GRADLE_VERSION.tmp.zip"
    echo "Baixando Gradle $GRADLE_VERSION do domínio oficial services.gradle.org…"
    curl --fail --location --retry 2 "https://services.gradle.org/distributions/gradle-$GRADLE_VERSION-bin.zip" -o "$TMP"
    EXPECTED="$(curl --fail --location --retry 2 "https://services.gradle.org/distributions/gradle-$GRADLE_VERSION-bin.zip.sha256" | awk '{print $1}')"
    ACTUAL="$(sha256sum "$TMP" | awk '{print $1}')"
    if [[ -z "$EXPECTED" || "$EXPECTED" != "$ACTUAL" ]]; then
      rm -f "$TMP"
      echo "ERRO: a soma SHA-256 da distribuição Gradle não confere. Arquivo removido." >&2
      exit 3
    fi
    STAGE="$CACHE/unpack-$GRADLE_VERSION"
    rm -rf "$STAGE"
    mkdir -p "$STAGE"
    unzip -q "$TMP" -d "$STAGE"
    rm -f "$TMP"
    mv "$STAGE/gradle-$GRADLE_VERSION" "$GRADLE_HOME_LOCAL"
    rmdir "$STAGE" 2>/dev/null || true
    GRADLE_CMD="$GRADLE_HOME_LOCAL/bin/gradle"
  fi
fi

cd "$ROOT"
"$GRADLE_CMD" --no-daemon --stacktrace :app:assembleDebug :app:testDebugUnitTest
APK="$ROOT/app/build/outputs/apk/debug/app-debug.apk"
if [[ ! -s "$APK" ]]; then
  echo "ERRO: as tarefas Gradle terminaram, mas o APK esperado não existe ou está vazio: $APK" >&2
  exit 4
fi
echo
echo "APK compilado e verificado no disco: $APK"
echo "O script não instala automaticamente o APK e não baixa modelo de linguagem."
