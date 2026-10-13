#!/data/data/com.termux/files/usr/bin/bash
# Instala o Gemini Code + compila llama.cpp e baixa um pequeno modelo local.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LLAMA_DIR="$HOME/llama.cpp"
MODEL_DIR="$HOME/models"
MODEL_NAME="Qwen2.5-1.5B-Instruct-Q4_K_M.gguf"
MODEL_URL="https://huggingface.co/bartowski/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/$MODEL_NAME"
MODEL_SHA256="1adf0b11065d8ad2e8123ea110d1ec956dab4ab038eab665614adba04b6c3370"

# Precisa de ~3 GB livres (modelo ~1 GB + compilação do llama.cpp).
LIVRE_KB=$(df -Pk "$HOME" | awk 'NR==2 {print $4}')
if [ "${LIVRE_KB:-0}" -lt 3145728 ]; then
  echo "Pouco espaço livre ($((LIVRE_KB / 1024)) MB). Libere pelo menos 3 GB e rode de novo."
  exit 1
fi

printf '\n== 1/5: dependências Termux ==\n'
pkg update -y
pkg install -y nodejs-lts git cmake clang make curl coreutils pkg-config libandroid-spawn

printf '\n== 2/5: dependências Gemini Code ==\n'
cd "$ROOT"
npm install

printf '\n== 3/5: compilando llama.cpp (sem Ollama) ==\n'
if [ ! -d "$LLAMA_DIR/.git" ]; then
  git clone --depth 1 https://github.com/ggml-org/llama.cpp.git "$LLAMA_DIR"
else
  git -C "$LLAMA_DIR" pull --ff-only || true
fi
if [ -x "$LLAMA_DIR/build/bin/llama-server" ] && [ "${REBUILD:-0}" != "1" ]; then
  echo "llama-server já compilado; pulando (use REBUILD=1 para recompilar)."
else
  cmake -B "$LLAMA_DIR/build" -DCMAKE_BUILD_TYPE=Release -DGGML_OPENMP=OFF
  # Dois jobs reduzem o pico de memória no celular. Pode demorar e aquecer o aparelho.
  cmake --build "$LLAMA_DIR/build" --target llama-server -j 2
fi

printf '\n== 4/5: baixando modelo GGUF (aprox. 986 MB) ==\n'
mkdir -p "$MODEL_DIR"
if [ -f "$MODEL_DIR/$MODEL_NAME" ] && ! printf '%s  %s\n' "$MODEL_SHA256" "$MODEL_DIR/$MODEL_NAME" | sha256sum -c --status -; then
  echo "Modelo existente está corrompido/incompleto; baixando de novo."
  rm -f "$MODEL_DIR/$MODEL_NAME"
fi
if [ ! -f "$MODEL_DIR/$MODEL_NAME" ]; then
  curl -L --fail --retry 3 --continue-at - "$MODEL_URL" -o "$MODEL_DIR/$MODEL_NAME.part"
  # Só vira o arquivo final se o SHA-256 bater (antes, um download quebrado ficava como "pronto" para sempre).
  if ! printf '%s  %s\n' "$MODEL_SHA256" "$MODEL_DIR/$MODEL_NAME.part" | sha256sum -c --status -; then
    echo "SHA-256 não confere. Apaguei o download; rode o script de novo."
    rm -f "$MODEL_DIR/$MODEL_NAME.part"
    exit 1
  fi
  mv "$MODEL_DIR/$MODEL_NAME.part" "$MODEL_DIR/$MODEL_NAME"
fi
printf '%s  %s\n' "$MODEL_SHA256" "$MODEL_DIR/$MODEL_NAME" | sha256sum -c -

printf '\n== 5/5: configurações ==\n'
node bin/gemini-code.js config set-provider hybrid
node bin/gemini-code.js config set-llamacpp-url http://127.0.0.1:8080
node bin/gemini-code.js config set-llamacpp-model local-model
node bin/gemini-code.js config set-llamacpp-ctx 4096
node bin/gemini-code.js config set-llamacpp-autostart on

cat <<TXT

Instalação concluída.

Pronto para usar — uma aba só:
   cd "$ROOT"
   node bin/gemini-code.js chat
O modelo local sobe sozinho em segundo plano na primeira pergunta (pode levar ~1 min para carregar).

Controle manual (opcional):
   node bin/gemini-code.js llamacpp start | stop | status | log
   bash "$ROOT/android/start-llama-server.sh"   # primeiro plano, para ver o log ao vivo

Para ensinar conhecimento ao agente, edite android/MEUS_CONHECIMENTOS.md e rode:
   node bin/gemini-code.js knowledge add android/MEUS_CONHECIMENTOS.md

Para ativar a nuvem, configure uma chave do Google AI Studio:
   node bin/gemini-code.js config set-key SUA_CHAVE
O modo hybrid usa a nuvem em pedidos complexos; sem internet fica no modelo local.
TXT
