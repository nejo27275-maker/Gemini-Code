# Entrega v0.25.0 — comandos /workflows testáveis, limpar, --erros

- Novo: `src/workflowCommands.js`, `tests/workflowsV025.test.js`.
- Alterado: `bin/gemini-code.js` (usa o módulo), `src/tools/workflowTools.js` (`limparHistorico`, `descartarEstado`, filtro `status`), README, CHANGELOG, versão 0.25.0.
- Testes: `npm test` (405 passando). Não testado: modelo real, Termux real.
