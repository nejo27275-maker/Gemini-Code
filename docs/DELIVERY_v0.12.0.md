# Entrega v0.12.0 — /rewind (desfazer por turno)

- Novo: `src/rewind.js`, `tests/rewind.test.js`. Alterado: `src/tools/fileTools.js` (registra o arquivo antes de gravar), `bin/gemini-code.js` (`/rewind`, aviso pós-turno), `src/customCommands.js` (nome reservado), README, CHANGELOG, versão 0.12.0.
- Testes: `npm test` (316). Não testado: chat real no Termux com o Gemini ao vivo.
- Limites: só `write_file`/`edit_file`; `run_shell` não é rastreado; sem git automático ainda; sem hooks nem aprovação por etapas.
