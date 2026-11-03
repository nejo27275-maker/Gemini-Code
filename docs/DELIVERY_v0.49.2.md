# Entrega v0.49.2 — o "você>" à prova de dedo e a pasta do usuário sempre certa

- **Ctrl+C com texto digitado no `você>`:** só apaga a linha. Antes, fechava o chat e perdia a mensagem.
- **Ctrl+D no `você>`:** sai e encerra os servidores MCP. Antes, com um servidor MCP rodando, o chat ficava pendurado.
  Com a entrada vindo de um pipe, a mensagem continua sendo respondida antes de sair.
- **(segurança) `HOME` vazio:** a config com a chave da API não vai mais para a pasta atual, e a sandbox esconde as
  credenciais de verdade (`pastaDoUsuario()` em src/config.js).
- **CI:** a instalação por `apt` tem prazo, nova tentativa e não puxa os "recomendados". Ela tinha travado duas vezes no
  runner.
- **Testes:** +1 no `chatTerminal.test.js` e +1 no `emAndamento.test.js`. Os dois falham no código anterior.
- Suíte inteira: 1004 no Node 20 e no 22, e no fuso de São Paulo (1003 passando, 1 pulado como root); ESLint 0 problemas.
