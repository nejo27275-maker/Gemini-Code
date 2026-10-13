# Entrega v0.8.0 — code-ia edita arquivo existente (com trava)

- Alterado: `src/providers/codeia.js` (`decidirEdicao`), `tests/codeia-v070.test.js`, CHANGELOG, versão 0.8.0.
- Testes: `npm test`. Não testado no Termux real nem com a API Gemini ao vivo.
- Limites: só troca de trecho exato e único; não reescreve arquivo, não apaga, não roda comando.
