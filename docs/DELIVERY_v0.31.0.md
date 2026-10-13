# Entrega v0.31.0 — config set-* testável

- Novo `src/configCommands.js` com os setters simples; `bin/gemini-code.js` só despacha.
- URL do llama.cpp/Ollama validada (http/https); `set-model` sem argumento não grava mais `undefined`.
- Testes novos em `tests/configCommands.test.js`.
- Não testado em Termux real.
