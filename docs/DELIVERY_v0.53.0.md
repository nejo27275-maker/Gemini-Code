# Entrega v0.53.0 — um site só

- **O site com tudo** (`gemini-code site --abrir`, um link só):
  - **No topo:** com quem conversar (o agente geral ou um aliado), o modo voz (a esfera, com a mesma conversa), o "Até
    terminar" e a conversa nova.
  - **Na caixa de mensagem:** o microfone dita, e a resposta de uma mensagem falada vem falada. O clipe manda foto,
    vídeo e áudio.
  - **Em cada resposta:** "Ouvir".
  - **Na esfera:** o botão "Chat" volta. Para abrir direto nela: `--voz`.
- **Trocar de aliado** (`/api/aliado`):
  - **O que aceita:** só um aliado que existe, nunca no meio de uma resposta.
  - **A conversa:** começa do zero, e cada aliado usa as ferramentas e a memória dele, como no `--aliado`.
- **A voz:** o reconhecimento e a fala do navegador. Só o texto final vai para o servidor.
- **Testes:** +5, inclusive o comando `site` de verdade e a página num Chromium de verdade (o seletor, o ditado, o
  "Ouvir" e a ida e volta da esfera).
  - **Simulados:** o reconhecimento e a síntese de voz, porque aqui não há microfone nem alto-falante.
  - **Não testado:** o microfone de um celular de verdade.
- **Checagens:** ESLint com 0 problemas.
