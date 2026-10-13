# Entrega v0.12.1 — git automático (/snapshots)

- Novo: `src/snapshots.js`, `tests/snapshots.test.js`. Alterado: `bin/gemini-code.js` (foto antes/depois do turno, `/snapshots`), `src/config.js` (`autoGit`), `src/customCommands.js`, README, CHANGELOG, versão 0.12.1.
- Testes: `npm test` (320). Verificado no chat real (`/snapshots`). Não testado: Gemini ao vivo, Termux real, repositórios grandes.
- Limites: só em repo git existente; arquivos grandes inflam o `.git`; restauração não apaga arquivos novos; sem hooks nem aprovação por etapas.
