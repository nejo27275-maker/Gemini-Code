# Entrega v0.9.0 — erro colado e mais erros comuns

- Alterado: `src/providers/codeia.js` (`limparErroColado`), `src/code-ia/seed/erros.md`, testes (eval 67 perguntas), CHANGELOG, versão 0.9.0.
- Testes: `npm test`. Não testado no Termux real nem com a API Gemini ao vivo.
- Limites: os blocos de erro foram escritos à mão; a limpeza do trace é por heurística e, se não reconhece o formato, usa o texto como veio.
