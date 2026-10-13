# Entrega v0.20.0 — retomar workflow

- Alterado: `src/agents/runner.js` (`deps.retomar`, erro com `indice`/`ctx`), `src/tools/workflowTools.js` (estado salvo, `retomar`, validade 24h, hash do workflow), `bin/gemini-code.js` (`/workflows retomar`), README, CHANGELOG, versão 0.20.0.
- Novo: `tests/workflowsV020.test.js`.
- Testes: `npm test` (375 passando). Não testado: modelo real, Termux real.
- Como usar: workflow falhou -> `/workflows retomar <nome>`.
