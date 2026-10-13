# Entrega v0.13.0 — hooks

- Novo: `src/hooks.js`, `tests/hooks.test.js`. Alterado: `src/agent.js` (Pre/PostToolUse em `executarChamada`), `bin/gemini-code.js` (`/hooks`), `src/customCommands.js`, README, CHANGELOG, versão 0.13.0.
- Testes: `npm test` (327). Bug achado e corrigido na própria entrega: hook que sai sem ler o stdin dava EPIPE e era tratado como falha.
- Não testado: Gemini ao vivo, Termux real. Limites: só hooks globais; hook não altera argumentos; sem aprovação por etapas ainda.
