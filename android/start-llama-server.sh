#!/data/data/com.termux/files/usr/bin/bash
# Sobe o llama-server em primeiro plano (útil para ver o log ao vivo).
# Dica: `node bin/gemini-code.js llamacpp start` faz o mesmo em segundo plano, sem ocupar uma aba.
set -euo pipefail
LLAMA_SERVER="${LLAMA_SERVER_BIN:-$HOME/llama.cpp/build/bin/llama-server}"
if [ -n "${LLAMA_MODEL_PATH:-}" ]; then
  MODEL_PATH="$LLAMA_MODEL_PATH"
elif [ -s "$HOME/storage/shared/Download/Qwen3-1.7B-Q4_K_M.gguf" ]; then
  MODEL_PATH="$HOME/storage/shared/Download/Qwen3-1.7B-Q4_K_M.gguf"
else
  MODEL_PATH="$HOME/models/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf"
fi
CTX="${LLAMA_CTX:-4096}"        # precisa bater com: gemini-code config set-llamacpp-ctx
THREADS="${LLAMA_THREADS:-4}"
PORT="${LLAMA_PORT:-8080}"
if [ ! -x "$LLAMA_SERVER" ]; then
  echo "Não achei llama-server em: $LLAMA_SERVER"
  echo "Rode primeiro: bash android/termux-install.sh"
  exit 1
fi
if [ ! -s "$MODEL_PATH" ]; then
  echo "Não achei o modelo GGUF em: $MODEL_PATH"
  echo "Rode primeiro: bash android/termux-install.sh"
  exit 1
fi
# Evita o Android suspender o processo com a tela apagada (só existe no Termux).
command -v termux-wake-lock >/dev/null 2>&1 && termux-wake-lock || true
# --jinja: necessário para o modelo chamar ferramentas (ler/editar arquivos, rodar comandos).
exec "$LLAMA_SERVER" --model "$MODEL_PATH" --ctx-size "$CTX" --threads "$THREADS" \
  --host 127.0.0.1 --port "$PORT" --jinja
