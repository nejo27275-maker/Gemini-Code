# Entrega v0.21.0 — custo por passo e maxTokens

- Alterado: `src/agents/runner.js` (tokens por passo via `src/usage.js`, orçamento `maxTokens`), `src/tools/workflowTools.js` (resumo de tokens, validação, dica de retomada), exemplo `diagnosticar-e-resumir`, README, CHANGELOG, versão 0.21.0.
- Novo: `tests/workflowsV021.test.js`.
- Testes: `npm test` (382 passando). Não testado: modelo real, Termux real.
