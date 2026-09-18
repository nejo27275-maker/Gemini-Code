#!/data/data/com.termux/files/usr/bin/bash
# install.sh — instala o gemini-code no Termux.
set -e

echo "== Atualizando pacotes do Termux =="
pkg update -y && pkg upgrade -y

echo "== Instalando Node.js e utilitários =="
pkg install -y nodejs-lts git termux-api

echo "== Instalando dependências do gemini-code =="
cd "$(dirname "$0")"
npm install

echo "== Deixando o comando disponível globalmente =="
npm link || (chmod +x bin/gemini-code.js && ln -sf "$(pwd)/bin/gemini-code.js" "$PREFIX/bin/gemini-code")

echo ""
echo "Instalação concluída!"
echo "Agora configure sua chave da API do Gemini (pegue em https://aistudio.google.com/apikey):"
echo "  gemini-code config set-key SUA_CHAVE_AQUI"
echo ""
echo "Depois teste com:"
echo "  gemini-code chat"
echo ""
echo "Dica: instale também o app 'Termux:API' na loja para usar voz e câmera."
