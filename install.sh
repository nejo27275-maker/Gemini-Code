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

echo "== Instalando conhecimento fixo (GEMINI.md / AGENTS.md) =="
mkdir -p "$HOME/.gemini-code/knowledge"
for f in knowledge/*.md; do
  destino="$HOME/.gemini-code/knowledge/$(basename "$f")"
  # nunca sobrescreve o que você já editou
  [ -e "$destino" ] || cp "$f" "$destino"
done
echo "== Instalando Skills locais =="
mkdir -p "$HOME/.gemini-code/skills"
for dir in skills/*/; do
  [ -d "$dir" ] || continue
  nome="$(basename "$dir")"
  destino="$HOME/.gemini-code/skills/$nome"
  # Skills personalizadas já instaladas nunca são sobrescritas.
  if [ ! -e "$destino/SKILL.md" ] && [ -f "$dir/SKILL.md" ]; then
    mkdir -p "$destino"
    cp "$dir/SKILL.md" "$destino/SKILL.md"
  fi
done

echo "== Instalando o code-ia (modelo próprio, sem download) =="
node bin/gemini-code.js code-ia status || echo "(o code-ia se instala sozinho na primeira execução)"

echo ""
echo "Instalação concluída!"
echo "O code-ia já está pronto: rode 'gemini-code' e converse, sem chave nenhuma."
echo "Pra usar também o Gemini (opcional), configure sua chave da API (pegue em https://aistudio.google.com/apikey):"
echo "  gemini-code config set-key SUA_CHAVE_AQUI"
echo ""
echo "Depois teste com:"
echo "  gemini-code chat"
echo ""
echo "Dica: instale também o app 'Termux:API' na loja para usar voz e câmera."
