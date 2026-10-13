# Entrega v0.32.0 — detector de laço

- Novo `src/loopGuard.js` ligado ao laço do agente (`src/agent.js`).
- 3ª repetição idêntica (mesma chamada e mesmo resultado): aviso no resultado. 5ª: encerra o turno.
- Testes: `tests/loopGuard.test.js`; `tests/agent.test.js` ajustado.
- Não testado com modelo real nem em Termux real.
