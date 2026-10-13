#!/data/data/com.termux/files/usr/bin/bash
# Instala a quantização compartilhada recomendada para MinhaIA + Gemini Code.
# Faz download somente de um modelo GGUF público; não instala executáveis de terceiros.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MODEL_NAME="Qwen3-1.7B-Q4_K_M.gguf"
MODEL_REV="7fb011e9aee6e4dc7adf8430df9ea8de6a466aa3"
MODEL_URL="https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/resolve/${MODEL_REV}/${MODEL_NAME}"
MODEL_SHA256="228fb5627f7510b8b3516cdb6435e4b0d2a2bf330fe5b0ab19284a3570a8bb1f"

if ! command -v node >/dev/null 2>&1; then echo "ERRO: instale Node.js primeiro: pkg install nodejs-lts" >&2; exit 2; fi
if ! command -v curl >/dev/null 2>&1 || ! command -v sha256sum >/dev/null 2>&1; then
  echo "ERRO: instale curl e coreutils: pkg install curl coreutils" >&2; exit 2
fi
if [[ ! -d "$HOME/storage/shared/Download" ]]; then
  echo "ERRO: não encontrei ~/storage/shared/Download." >&2
  echo "Para compartilhar o mesmo GGUF entre o Gemini Code e o app MinhaIA, execute termux-setup-storage, autorize o acesso aos arquivos e rode este script novamente." >&2
  exit 2
fi

MODEL_DIR="$HOME/storage/shared/Download"
MODEL_PATH="$MODEL_DIR/$MODEL_NAME"
AVAILABLE_KB="$(df -Pk "$MODEL_DIR" | awk 'NR==2 {print $4}')"
# Modelo ~1.11 GB; exigir espaço adicional para evitar falha silenciosa de armazenamento.
if [[ "${AVAILABLE_KB:-0}" -lt 2500000 ]]; then
  echo "ERRO: há pouco espaço livre em Downloads (${AVAILABLE_KB:-0} KB). Libere pelo menos 2,5 GB antes de continuar." >&2
  exit 2
fi
mkdir -p "$MODEL_DIR"

if [[ -s "$MODEL_PATH" ]] && printf '%s  %s\n' "$MODEL_SHA256" "$MODEL_PATH" | sha256sum -c --status -; then
  echo "Modelo já existe e SHA-256 foi validado: $MODEL_PATH"
else
  [[ ! -e "$MODEL_PATH" ]] || { echo "O modelo existente está incompleto ou tem hash incorreto; preservando-o como backup .invalid." >&2; mv "$MODEL_PATH" "$MODEL_PATH.invalid.$(date +%s)"; }
  PART="$MODEL_PATH.part"
  echo "Baixando Qwen3-1.7B Q4_K_M da revisão fixa $MODEL_REV (aprox. 1,11 GB)…"
  curl --fail --location --retry 3 --continue-at - "$MODEL_URL" -o "$PART"
  if ! printf '%s  %s\n' "$MODEL_SHA256" "$PART" | sha256sum -c --status -; then
    rm -f "$PART"
    echo "ERRO: SHA-256 não confere. O arquivo temporário foi removido; o modelo não foi ativado." >&2
    exit 3
  fi
  mv "$PART" "$MODEL_PATH"
  printf '%s  %s\n' "$MODEL_SHA256" "$MODEL_PATH" | sha256sum -c -
fi

node "$ROOT/bin/gemini-code.js" config set-llamacpp-path "$MODEL_PATH"
node "$ROOT/bin/gemini-code.js" config set-provider llamacpp
node "$ROOT/bin/gemini-code.js" config set-llamacpp-ctx 2048
node "$ROOT/bin/gemini-code.js" config set-llamacpp-autostart on

cat <<TXT

Modelo compartilhado configurado.
  Arquivo: $MODEL_PATH
  SHA-256: $MODEL_SHA256
  Contexto do servidor: 2048 tokens
  Provedor do Gemini Code: llama.cpp local (não faz fallback para nuvem)

Para conversar no Gemini Code:
  node "$ROOT/bin/gemini-code.js" chat

Para usar o mesmo arquivo no app Android:
  abra mobile/MinhaIA no Android Studio, compile/instale o APK e escolha Modelo > Importar outro GGUF;
  selecione Downloads/$MODEL_NAME. O app copia o modelo para o armazenamento privado, então reserve
  espaço livre adicional de aproximadamente 1,2 GB. A inferência acontece no app, sem API.

Verificação do servidor:
  node "$ROOT/bin/gemini-code.js" llamacpp status
TXT
