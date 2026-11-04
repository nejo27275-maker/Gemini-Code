# Entrega v0.49.3 — caça aos bugs: a pasta do usuário em todo lugar e o contraste do chat

- **(segurança) `HOME` vazio, o resto:** `config add-pasta-gravavel`, a pergunta do `write_file`/`edit_file` antes de
  gravar `~/.bashrc` (com o projeto na pasta do usuário), os checkpoints, o `computador`, o navegador, o `doctor` e o
  `sandbox status` usam `pastaDoUsuario()`. Antes, comparavam com a pasta atual. Não sobrou nenhum `os.homedir()` solto.
- **Contraste do chat no tema claro:** o azul dos links passou de 4,26:1 para 4,82:1 sobre o fundo (mínimo WCAG AA,
  4,5:1).
- **README:** o que o projeto é vem primeiro, e o modo site virou um item só na lista.
- **Procurado e não achado (medido):**
  - 10.248 execuções dos 57 comandos com argumentos estranhos;
  - 150.000 textos no Markdown seguro;
  - Ctrl+C no `gemini-code live` (resposta, fala e escuta) num pseudo-terminal de verdade;
  - nomes acessíveis e idioma nas duas páginas.
- **Não rodou:** a suíte no Node 18 (não há Node 18 aqui e o download foi bloqueado). A busca por APIs mais novas que o
  Node 18 não achou nenhuma.
- **Testes:**
  - `pastaDoUsuario.test.js` (novo, 3);
  - `site.test.js` (+1, contraste);
  - todos falham no código anterior (conferido).
- **Achado no CI (commit ee0ae20):** no Node 20 e no 22, o passo dos testes ficou parado até ser cancelado.
  - **Causa:** uma corrida entre o `navegador.test.js` e o `site.test.js`, que abrem o navegador em paralelo e
    compartilhavam o /tmp. O teste que falhava não fechava o Chrome, e o arquivo ficava pendurado.
  - **Correção:** o `navegador.test.js` usa uma pasta temporária só dele, e o teste do print sempre fecha o navegador.
    Reproduzido antes e conferido depois.
- **Suíte inteira:** 1008 testes no Node 22, no 20 e no fuso de São Paulo (1007 passando, 1 pulado como root). ESLint 0
  problemas.
