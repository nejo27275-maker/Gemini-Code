# Entrega v0.48.1 — "Parar" de verdade

**O que mudou:**
- **Antes:** no modo site, Esc e fechar a página só paravam a voz do navegador. O agente seguia rodando no computador e a
  próxima mensagem recebia "ainda estou respondendo".
- **Agora:** enquanto o agente trabalha, o botão do microfone vira **Parar** (um quadrado). Ele e o **Esc** param o agente
  de verdade, e a pergunta aberta conta como "não". Fechar a página no meio também para.
- **Onde o agente para (`runOnce({ signal })`):**
  - não chama o modelo de novo;
  - não roda a próxima ferramenta;
  - não espera a resposta que está chegando.
  - Uma ação que já começou termina antes, para não deixar arquivo pela metade.
- **Provedores** (Gemini, compatível com OpenAI, llama.cpp, Ollama): cortam a conexão. Depois do "Parar" não repetem, não
  trocam de lado, não usam o modelo reserva e não ligam o llama.cpp.
- **Sem "Parar":** nada muda (terminal, rotinas, cowork).

**Testes:**
- Novos: `tests/parar.test.js` (9) e `tests/site.test.js` (+5).
- Inclui o botão "Parar" clicado num Chromium de verdade e um servidor falso que vê a conexão cair.
- Contra o código antigo, esses testes falham ou travam.
- Suíte inteira: 986 no Node 20 e no 22, e no fuso de São Paulo (985 passando, 1 pulado como root). ESLint 0 problemas.
