# Entrega v0.24.0 — each retomável, histórico do terminal, resumo

- Alterado: `src/agents/runner.js` (progresso parcial do `each`), `src/tools/workflowTools.js` (`estatisticas`, `formatarEstatisticas`, `rodarComHistorico`, parâmetro `resumo`, estado com `parcial`), `bin/gemini-code.js` (`agent run` registra histórico, `/workflows resumo`), README, CHANGELOG, versão 0.24.0.
- Novo: `tests/workflowsV024.test.js`. Ajustado: 1 teste em `tests/workflowsV022.test.js`.
- Testes: `npm test` (400 passando). Não testado: modelo real, Termux real.
