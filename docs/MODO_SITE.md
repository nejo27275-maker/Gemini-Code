# Modo site — conversar pelo navegador: voz com a esfera, ou a versão chat (v0.48.0; "Parar" na v0.48.1; chat na v0.49.0)

`gemini-code site` abre uma página no seu navegador para conversar com o agente **por voz ou por texto**. No centro
fica uma esfera brilhante com anéis e um círculo de "risquinhos" que reagem: seguem o seu microfone quando ele ouve,
giram em violeta quando ele pensa, pulsam no ritmo da fala quando ele responde e ficam âmbar quando ele precisa da sua
permissão.

```bash
gemini-code site --abrir                    # abre o navegador já no endereço certo (a página de voz)
gemini-code site --chat --abrir             # abre a VERSÃO CHAT: uma conversa comum, por texto, sem a esfera
gemini-code site --aliado central --abrir   # conversa com um aliado (ex.: o "central": computador, celular, sites, redes)
gemini-code site --porta 0                  # qualquer porta livre (padrão: 8765)
```

O terminal mostra os dois endereços, `http://127.0.0.1:8765/chat#t=...` (chat) e `http://127.0.0.1:8765/#t=...` (voz).
A parte `#t=...` é uma **chave que muda a cada vez**: abra o endereço completo e não compartilhe. As duas páginas são
a mesma conversa.

## A versão chat (v0.49.0)

Um chat comum, claro ou escuro conforme o seu sistema, sem esfera nem voz:

- **Respostas formatadas:** títulos, listas, tabelas, citações e blocos de código com o botão **Copiar**. Tudo é montado
  como texto: nada que o modelo escreve vira código na página.
- **Links:** só `http`/`https`. Um link com texto próprio mostra o domínio de verdade ao lado, como em
  "página da loja (loja.example)".
- **Resposta ao vivo:** ela aparece conforme chega, com as ferramentas que o agente usou (⚙ browser, ⚙ adb...).
- **Permissões:** aparecem **no meio da conversa**, com "Permitir", "Não permitir" ou outra resposta (como "sempre").
- **Parar:** enquanto ele responde, o botão de enviar vira **Parar** (ou aperte **Esc**).
- **Enter:** no PC, Enter envia e Shift+Enter quebra a linha. No celular, Enter quebra a linha e quem envia é o botão.
- **Nova conversa:** começa do zero.
- **Recarregar:** recarregar a página traz a conversa de volta.

## A página de voz

### Usar

- **Falar:** toque no microfone (ou aperte **espaço**). Fale; quando você para, ele envia.
- **Parar:** enquanto o agente trabalha, o botão do microfone vira **Parar** (um quadrado). Ele e o **Esc** param o
  agente de verdade: ele não chama o modelo de novo, não usa a próxima ferramenta e uma pergunta aberta conta como
  "não". Um comando de terminal em andamento é interrompido, como o Ctrl+C de um terminal (v0.49.1). Já uma ação como
  gravar um arquivo termina antes, para não ficar pela metade.
  Fechar a página no meio também para o agente. O espaço continua sendo só "falar".
- **Contínuo:** depois de responder, ele volta a ouvir sozinho — uma conversa sem as mãos.
- **Falar respostas:** liga/desliga a leitura em voz alta (o texto aparece sempre).
- **Conversa:** o histórico desta sessão; "Limpar" começa do zero.
- **Digitar:** o campo de baixo funciona igual (Enter envia).
- **Permissões:** quando uma ferramenta precisa de confirmação (clicar no computador, tocar no celular, publicar numa
  rede...), a pergunta aparece **na página** com "Sim, permitir" / "Não" (ou outra resposta, como "sempre"). Sem
  resposta em 2 minutos, conta como "não".

### Voz: o que precisa

- **Chrome** ou **Edge** (no PC ou no Android). O Firefox não tem reconhecimento de voz; o Safari funciona em parte.
- O reconhecimento de voz do Chrome usa a internet (serviço do próprio navegador). A leitura em voz alta usa as vozes
  do sistema (português do Brasil, quando houver).
- Permita o microfone quando o navegador perguntar. `127.0.0.1` conta como endereço seguro, então funciona sem HTTPS.
- No celular (Termux): rode `gemini-code site` no Termux e abra o endereço no Chrome do próprio celular.

## Segurança

O modo site roda o agente com as ferramentas dele, então o servidor é fechado:

- só atende em `127.0.0.1` (outros aparelhos da rede não alcançam);
- toda chamada precisa da chave da sessão, que vai no fragmento do endereço (`#t=`: não vai para log nem para outros
  sites) e sai da barra de endereço assim que a página abre;
- outro site aberto no seu navegador não consegue mandar ordens: a chave é exigida, o servidor nunca libera CORS e
  confere a origem e o `Host` (contra *DNS rebinding*);
- a página só carrega os próprios arquivos (CSP fechada), não abre dentro de outro site e mostra tudo como texto — uma
  resposta do modelo nunca vira código na página;
- uma conversa por vez; mensagens de até 16.000 caracteres;
- página fechada no meio = agente parado (ninguém olhando, nada de seguir usando ferramentas nem gastando cota).

## Limites honestos

- Testado com um Chromium de verdade (a página sobe, a esfera desenha, a conversa vai e volta, as permissões aparecem)
  e com a voz **simulada**: este ambiente não tem microfone nem alto-falante. A qualidade do reconhecimento depende do
  navegador e do microfone.
- O estilo da esfera é inspirado nos assistentes de filmes de ficção; o desenho é próprio.
- A versão chat foi testada num Chromium de verdade, de ponta a ponta: resposta formatada, ferramenta, permissão no
  meio, recarregar e parar. Também passou por prints no tema claro, no escuro e no celular. O Markdown é um subconjunto
  do dia a dia; um recurso raro (HTML, nota de rodapé, título sublinhado) aparece como texto.
