# Entrega v0.7.0 — code-ia: gerador indexado, "outra", "só o código" e corpus ampliado

- Alterado: `src/code-ia/model.js` (índice de posições para o gerador), `src/providers/codeia.js` (`outra`, `só o código`), `src/code-ia/seed/extras.md` (novos blocos), `tests/codeia-eval.test.js` (59 perguntas), `tests/codeia-v070.test.js` (novo), README, CHANGELOG, versão 0.7.0.
- Testes: `npm test` e `npm run lint` (ver resultado no fim da conversa).
- Não testado: execução no Termux real do usuário e uso junto com a API Gemini ao vivo (nenhuma chamada de rede foi feita).
- Limites: continua sendo um modelo pequeno (busca + contexto); os blocos novos do corpus foram escritos à mão e não foram executados contra serviços reais (ex.: Mercado Pago).
