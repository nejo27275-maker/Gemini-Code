# Entrega v0.14.0 — modo plano com aprovação

- Novo: `src/planMode.js`, `tests/planMode.test.js`. Alterado: `bin/gemini-code.js` (`/plano`, `/aprovar`, prompt `[plano]`, allowlist no `runOnce`), `src/customCommands.js`, README, CHANGELOG, versão 0.14.0.
- Testes: `npm test`. Não testado: Gemini ao vivo (se o modelo escreve bons planos), Termux real.
- Limites: aprovação do plano inteiro, não por etapa; `/aprovar` confia no plano que está no histórico.
