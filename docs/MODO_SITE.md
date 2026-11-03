# Modo site — conversar por voz com a esfera (v0.48.0; "Parar" na v0.48.1)

`gemini-code site` abre uma página no seu navegador para conversar com o agente **por voz ou por texto**. No centro
fica uma esfera brilhante com anéis e um círculo de "risquinhos" que reagem: seguem o seu microfone quando ele ouve,
giram em violeta quando ele pensa, pulsam no ritmo da fala quando ele responde e ficam âmbar quando ele precisa da sua
permissão.

```bash
gemini-code site --abrir                    # abre o navegador já no endereço certo
gemini-code site --aliado central --abrir   # conversa com um aliado (ex.: o "central": computador, celular, sites, redes)
gemini-code site --porta 0                  # qualquer porta livre (padrão: 8765)
```

O terminal mostra um endereço como `http://127.0.0.1:8765/#t=...`. A parte `#t=...` é uma **chave que muda a cada vez**:
abra o endereço completo e não compartilhe.

## Usar

- **Falar:** toque no microfone (ou aperte **espaço**). Fale; quando você para, ele envia.
- **Parar:** enquanto o agente trabalha, o botão do microfone vira **Parar** (um quadrado). Ele e o **Esc** param o
  agente de verdade: ele não chama o modelo de novo, não usa a próxima ferramenta e uma pergunta aberta conta como
  "não". Uma ação que já começou (gravar um arquivo, por exemplo) termina antes, para não ficar pela metade.
  Fechar a página no meio também para o agente. O espaço continua sendo só "falar".
- **Contínuo:** depois de responder, ele volta a ouvir sozinho — uma conversa sem as mãos.
- **Falar respostas:** liga/desliga a leitura em voz alta (o texto aparece sempre).
- **Conversa:** o histórico desta sessão; "Limpar" começa do zero.
- **Digitar:** o campo de baixo funciona igual (Enter envia).
- **Permissões:** quando uma ferramenta precisa de confirmação (clicar no computador, tocar no celular, publicar numa
  rede...), a pergunta aparece **na página** com "Sim, permitir" / "Não" (ou outra resposta, como "sempre"). Sem
  resposta em 2 minutos, conta como "não".

## Voz: o que precisa

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
- uma conversa por vez; mensagens de até 4.000 caracteres;
- página fechada no meio = agente parado (ninguém olhando, nada de seguir usando ferramentas nem gastando cota).

## Limites honestos

- Testado com um Chromium de verdade (a página sobe, a esfera desenha, a conversa vai e volta, as permissões aparecem)
  e com a voz **simulada**: este ambiente não tem microfone nem alto-falante. A qualidade do reconhecimento depende do
  navegador e do microfone.
- O estilo da esfera é inspirado nos assistentes de filmes de ficção; o desenho é próprio.
