# Entrega v0.16.0 — aprovação passo a passo (/passo)

- Novo: `src/stepApproval.js`, `tests/stepApproval.test.js`. Alterado: `src/agent.js` (gate depois dos hooks), `bin/gemini-code.js` (`/passo`, config no início do chat), `src/config.js` (`confirmarEscrita`), `src/customCommands.js`, README, CHANGELOG, versão 0.16.0.
- Testes: `npm test`. Verificado no chat real (`/passo`, `/passo off`, uso inválido). Não testado: pergunta s/n/t com o Gemini ao vivo, Termux real.
- Limites: prévia truncada em 12 linhas; só write_file/edit_file.
