# Entrega v0.11.0 — todo_write, /compact e comandos de barra seus

- Novo: `src/tools/todoTools.js`, `src/compact.js`, `src/customCommands.js`, `tests/agentePadroes.test.js`. Alterado: `src/tools/index.js`, `src/agent.js` (prompt), `bin/gemini-code.js` (`/compact`, `/tarefas`, `/commands`, comando seu), CHANGELOG, versão 0.11.0.
- Testes: `npm test`. Verificado também no chat real (entrada com pausa entre linhas).
- Não testado: uso com a API do Gemini ao vivo (o modelo realmente chamar `todo_write` bem) nem no Termux real.
- Limites: o resumo do `/compact` é heurístico (não entende o conteúdo); `todo_write` só vale se o modelo decidir usá-lo; não há hooks nem modo de aprovação por etapas ainda.
