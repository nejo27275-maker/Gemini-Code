# Entrega v0.49.0 — versão chat do modo site

- **`gemini-code site --chat --abrir`:** um chat comum no navegador, sem nada da esfera. É claro ou escuro conforme o
  sistema e funciona no celular.
  - **Respostas formatadas:** listas, tabelas, citações e código com o botão "Copiar".
  - **Links:** só http/https, com o domínio de verdade à mostra.
  - **Permissões:** aparecem no meio da conversa.
  - **Controles:** botão Parar (ou Esc) e nova conversa.
  - **Recarregar:** a conversa volta depois de recarregar a página.
- **Mesmo servidor, mesma conversa e mesma segurança da página de voz:** só 127.0.0.1, chave por execução, Host e Origin
  conferidos, CSP fechada, e nada do modelo vira HTML.
- **Melhorias:**
  - código comum às duas páginas (`comum.js`), com o Markdown seguro;
  - a página de voz mostra a resposta formatada e o histórico ao recarregar;
  - as opções do `site` ficaram mais rigorosas;
  - mensagens de até 16 mil caracteres;
  - o bug da lista com marcadores logo depois de uma numerada foi corrigido;
  - uma mensagem mandada antes de o histórico chegar não some nem aparece duas vezes.
- **Testes:**
  - `site.test.js` tem 6 testes novos, com o chat de ponta a ponta num Chromium de verdade;
  - o Markdown foi testado com texto hostil e enorme;
  - prints no tema claro, no escuro e no celular;
  - suíte inteira: 992 no Node 20 e no 22, e no fuso de São Paulo (991 passando, 1 pulado como root); ESLint 0 problemas.
