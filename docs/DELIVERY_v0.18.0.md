# Entrega v0.18.0 — workflows à prova de erro

- Alterado: `src/agents/runner.js` (`{{var|padrão}}`, `analisarVariaveis`, `retry`/`optional`/`model`/`tools` por passo), `src/tools/workflowTools.js` (checa vars antes de rodar, interseção de ferramentas, marcador `NENHUMA`), `src/rewind.js` (id de turno sempre crescente), `bin/gemini-code.js` (`/workflows rodar`), README, CHANGELOG, versão 0.18.0.
- Novo: `tests/workflowsV018.test.js`, `workflows/exemplos/diagnosticar-e-resumir.json`.
- Testes: `npm test` (361 passando). Não testado: o modelo real preenchendo `vars`, Termux real.
- Atenção: `{{x}}` sem valor e sem padrão agora é ERRO no `run_workflow` (no `agent run` continua virando vazio, como antes).
