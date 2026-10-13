# Entrega v0.15.0 — custo de IA sob controle

- Novo: `src/usage.js`, `tests/usage.test.js`. Alterado: `src/gemini.js` (captura `usageMetadata`), `src/provider.js` (limite + contagem local), `src/config.js` (`maxTokensSessao`, `autoCompactTokens`), `bin/gemini-code.js` (`/custo`, auto-compact), `src/customCommands.js`, README, CHANGELOG, versão 0.15.0.
- Testes: `npm test` (337). Não testado: Gemini ao vivo (formato real do `usageMetadata` foi simulado a partir da API documentada), Termux real.
- Limites: contagem só do processo; `generateText` (design/mídia) fora; Ollama sem tokens.
