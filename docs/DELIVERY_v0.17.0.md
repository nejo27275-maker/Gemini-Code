# Entrega v0.17.0 — run_workflow

- Novo: `src/tools/workflowTools.js`, `tests/workflowTools.test.js`, `workflows/exemplos/revisar-e-resumir.json`. Alterado: `src/tools/index.js`, `src/agents/runner.js` (`deps.vars`), `src/agent.js` (linha no prompt), `bin/gemini-code.js` (`/workflows`), `src/customCommands.js`, README, CHANGELOG, versão 0.17.0.
- Testes: `npm test`. Não testado: o modelo real escolhendo o workflow certo pela descrição, Termux real.
- Limites: só pasta global; máx. 10 passos; sem aninhamento; N passos = N chamadas de IA.
