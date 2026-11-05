# Entrega v0.53.1 — o erro do microfone na tela, com o caminho certo

- **O erro não aparecia na tela:** no chat, o erro do microfone ia só para o leitor de tela. Agora aparece na
  conversa, um de cada vez.
- **Mensagem errada:** o "service-not-allowed" (o navegador não deixa usar o reconhecimento de voz) dizia "permita o
  microfone". Agora explica que não é o microfone: é preciso abrir no Chrome e conferir o app Google.
- **Cada erro com o seu caminho**, no chat e na esfera (`comum.js`, `mensagemDeErroDeVoz`):
  - microfone bloqueado no site ou no Android;
  - microfone ocupado;
  - sem internet;
  - sem o português.
- **Microfone já bloqueado:** o chat explica sem tentar ouvir.
- **Testes:** +2. O teste do Chromium falha no código anterior.
- **Guia:** a tabela "Se o microfone não funcionar" em `docs/MODO_SITE.md`.
- **Não testado:** o microfone de um celular de verdade. Aqui o reconhecimento de voz é simulado.
