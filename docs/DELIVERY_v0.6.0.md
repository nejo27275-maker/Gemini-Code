# Entrega v0.6.0 — code-ia: digitação, criar arquivos, ensinar no chat

- Novo/alterado: `src/code-ia/*` (tokenizer com sinônimos, busca com bônus de título, gerador de contexto longo, aprendizado de código, `esquecer`), `src/providers/codeia.js` (conversa, acompanhamento, ferramentas de leitura), seed ampliado (92 blocos), CLI (`code-ia forget`), README, CHANGELOG.
- Testes: `npm test` (inclui `tests/codeia.test.js` e `tests/codeia-eval.test.js`); `npm run lint` faz verificação sintática.
- Não testado: execução no Termux real do usuário e uso junto com a API Gemini ao vivo (nenhuma chamada de rede foi feita).
- Limites: modelo pequeno (busca + contexto), sem raciocínio profundo; cria só arquivo novo (nunca sobrescreve); `complete` pode emendar trechos parecidos de fontes diferentes quando há código repetido no corpus.
