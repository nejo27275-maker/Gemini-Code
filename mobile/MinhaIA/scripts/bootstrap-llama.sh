#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/external/llama.cpp"
REF="${LLAMA_CPP_REF:-master}"

command -v git >/dev/null 2>&1 || { echo "ERRO: instale git para buscar o código oficial do llama.cpp." >&2; exit 2; }
command -v python3 >/dev/null 2>&1 || { echo "ERRO: instale Python 3 para validar e ajustar a configuração nativa." >&2; exit 2; }

mkdir -p "$ROOT/external"
if [[ ! -d "$DEST/.git" ]]; then
  if [[ -e "$DEST" ]]; then
    echo "ERRO: $DEST existe, mas não é um clone Git. Faça backup e mova-o manualmente; nada será apagado." >&2
    exit 2
  fi
  echo "Clonando o repositório oficial ggml-org/llama.cpp (não baixa pesos de modelos)…"
  git clone --depth 1 https://github.com/ggml-org/llama.cpp.git "$DEST"
  if [[ "$REF" != "master" ]]; then
    git -C "$DEST" fetch --depth 1 origin "$REF"
    git -C "$DEST" checkout --detach FETCH_HEAD
  fi
else
  echo "Usando clone existente; nenhuma atualização automática será feita."
  if [[ "$REF" != "master" ]]; then
    git -C "$DEST" fetch --depth 1 origin "$REF"
    git -C "$DEST" checkout --detach FETCH_HEAD
  fi
fi

CPP="$DEST/examples/llama.android/lib/src/main/cpp/ai_chat.cpp"
[[ -f "$CPP" ]] || { echo "ERRO: a versão obtida não contém a implementação Android esperada: $CPP" >&2; exit 3; }
python3 - "$CPP" <<'PY'
from pathlib import Path
import re, sys
p = Path(sys.argv[1])
s = p.read_text(encoding="utf-8")
changes = {
    r"constexpr int\s+DEFAULT_CONTEXT_SIZE\s*=\s*(\d+);": (2048, "DEFAULT_CONTEXT_SIZE"),
    r"constexpr int\s+BATCH_SIZE\s*=\s*(\d+);": (128, "BATCH_SIZE"),
}
for pattern, (target, label) in changes.items():
    matches = list(re.finditer(pattern, s))
    if len(matches) != 1:
        current = re.findall(pattern, s)
        if current and all(int(x) == target for x in current):
            continue
        raise SystemExit(f"ERRO: esperado exatamente um parâmetro {label}; encontrados {current}. Não vou modificar uma versão incompatível.")
    m = matches[0]
    value = int(m.group(1))
    if value == target:
        continue
    s = s[:m.start(1)] + str(target) + s[m.end(1):]
p.write_text(s, encoding="utf-8")
print("Configuração nativa ajustada: contexto=2048, lote=128.")
PY

python3 "$ROOT/scripts/patch-llama-android.py" "$DEST"

COMMIT="$(git -C "$DEST" rev-parse HEAD)"
printf 'Repositório: https://github.com/ggml-org/llama.cpp\nCommit utilizado: %s\nRef solicitada na primeira preparação: %s\nPatch local: DEFAULT_CONTEXT_SIZE=2048; BATCH_SIZE=128; redefinicao do prompt entre turnos no wrapper Kotlin\n' "$COMMIT" "$REF" > "$ROOT/docs/LLAMA_CPP_REVISION.txt"
echo "Dependência preparada. Commit: $COMMIT"
echo "Patches locais aplicados: contexto=2048, lote=128 e redefinição de prompt por turno."
echo "O clone não inclui pesos de modelos; eles devem ser obtidos separadamente e importados no app."
