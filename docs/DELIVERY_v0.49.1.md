# Entrega v0.49.1 — Ctrl+C de verdade no chat do terminal

- **Antes:** no `gemini-code chat`, Ctrl+C no meio de uma resposta não parava nada. A resposta seguia até o fim (com
  ferramentas) e o chat fechava sozinho depois. Isso foi reproduzido num pseudo-terminal de verdade.
- **Agora:**
  - **Ctrl+C durante a resposta:** para a resposta, corta a conexão com o modelo e volta para o `você>`.
  - **Numa pergunta de permissão:** vale "não".
  - **Com um comando rodando:** interrompe o comando como um terminal (SIGINT, e SIGKILL em 2 s se ele ignorar).
  - **Ctrl+C de novo, ou no `você>`:** sai.
  - **Nenhum comando órfão:** nada fica rodando sozinho depois de sair (`src/emAndamento.js`).
  - **Modo site:** o "Parar" também interrompe o comando em andamento.
- **Testes:**
  - `chatTerminal.test.js` (3): o chat de verdade num pseudo-terminal. Contra o código antigo, os 3 falham.
  - `emAndamento.test.js` (7).
  - Suíte inteira: 1002 no Node 20 e no 22, e no fuso de São Paulo (1001 passando, 1 pulado como root); ESLint 0 problemas.
  - CI (commit bac4963): 1002/1002 nos Node 20, 22 e 24, nenhum pulado.
