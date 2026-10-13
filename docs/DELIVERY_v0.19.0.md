# Entrega v0.19.0 — workflows condicionais + agent check

- Alterado: `src/agents/runner.js` (`avaliarCondicao`, `when`/`unless`), `src/tools/workflowTools.js` (`validarWorkflow`/`validarArquivo`, resultado final = último passo que rodou), `bin/gemini-code.js` (`agent check`, `/workflows validar`), README, CHANGELOG, versão 0.19.0.
- Novo: `tests/workflowsV019.test.js`, `workflows/exemplos/revisar-e-corrigir.json`.
- Testes: `npm test` (370 passando). Não testado: modelo real, Termux real.
- Como usar: `gemini-code agent check workflows/exemplos/revisar-e-corrigir.json`.
