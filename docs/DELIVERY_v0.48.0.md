# Entrega v0.48.0 — modo site: conversa por voz com a esfera

- **`gemini-code site --abrir`** (guia `docs/MODO_SITE.md`): página para conversar com o agente por voz ou texto.
- **Esfera animada:** núcleo, anéis, arcos que giram e um círculo de 120 risquinhos.
  - ouvindo: os risquinhos seguem o microfone;
  - pensando: violeta;
  - falando: pulsa com as palavras;
  - pedindo permissão: âmbar.
- **Voz pelo navegador** (Chrome/Edge, no PC ou no Android): modo contínuo, espaço/Esc e histórico.
- **Permissões das ferramentas na própria página:** sem resposta, contam como "não".
- **`--aliado central`:** comanda computador, celular, sites e redes pela voz.
- **Segurança:**
  - endereço só 127.0.0.1, com uma chave por execução;
  - Host e Origin conferidos, e nunca CORS;
  - CSP fechada, e a página mostra tudo como texto;
  - uma conversa por vez.
- **Testes:** 972 no Node 20 e no 22, e também no fuso de São Paulo (971 passando, 1 pulado como root). Novos: `tests/site.test.js` (8), com a página num Chromium de verdade. Prints de todos os estados, no PC e no celular.
- **Não testado aqui:** microfone e alto-falante de verdade (a voz foi simulada no navegador).
