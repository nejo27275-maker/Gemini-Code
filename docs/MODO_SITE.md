# Modo site — tudo num site só: conversa, voz, foto e vídeo, aliados (v0.48.0; "Parar" na v0.48.1; chat na v0.49.0; foto e vídeo na v0.51.0; só com a chave do Gemini e "até terminar" na v0.52.0; um site só na v0.53.0)

`gemini-code site` abre o site do Gemini Code no seu navegador. Desde a v0.53.0, é **um site só**, com tudo junto.

```bash
gemini-code site --abrir                      # abre o site (só neste aparelho)
gemini-code site --aliado treinador --abrir   # já começa com um aliado (dá para trocar no topo)
gemini-code site --voz --abrir                # abre direto no modo voz (a esfera)
gemini-code site --porta 0                    # qualquer porta livre (padrão: 8765)
```

O terminal mostra um link só, `http://127.0.0.1:8765/chat#t=...`. A parte `#t=...` é uma **chave que muda a cada
vez**: abra o endereço completo e não compartilhe.

## Um site só (v0.53.0)

- **No topo:**
  - **com quem você conversa:** o agente geral ou um dos seus aliados (o treinador, o central...). Cada aliado tem as
    ferramentas, a memória e as instruções dele, e trocar começa uma conversa nova;
  - **Modo voz:** abre a esfera, para conversar sem as mãos, com a mesma conversa. Na esfera, o botão **Chat** volta;
  - **Até terminar** e **Nova conversa**.
- **Na caixa de mensagem:**
  - o **microfone** dita a mensagem: fale, e quando você parar ela vai. Uma mensagem falada ganha a resposta falada;
  - o **clipe** manda foto, vídeo ou áudio.
- **Em cada resposta:** **Ouvir** lê a resposta em voz alta. Tocar de novo para.
- **O microfone e a fala:** usam o reconhecimento e a voz do próprio navegador (Chrome ou Edge). No celular, se o
  navegador não deixar usar o microfone, o site ouve pelo app **Termux:API** (v0.53.2, veja abaixo). Sem nenhum dos
  dois, o microfone não aparece.
- **Até a v0.52.0:** a voz e o chat eram duas páginas, e o aliado era fixo por execução. O `--chat` continua aceito,
  mas não precisa mais.

### Se o microfone não funcionar (v0.53.1, v0.53.2)

Ao tocar no microfone, o site faz o pedido padrão do navegador ("Permitir que 127.0.0.1 use o microfone?"). É esse
pedido que faz o Chrome perguntar, e que diz por que recusou. O aviso aparece na conversa com o motivo exato no fim
(`detalhe: ...`), e cada caso tem um caminho:

| O aviso | O que fazer (Chrome no Android) |
|---|---|
| **Microfone bloqueado** | Toque no ícone à esquerda do endereço › **Permissões › Microfone › Permitir**, e recarregue. Se lá disser que o site não tem permissões, o bloqueio é do Chrome inteiro: **Chrome › ⋮ › Configurações › Configurações do site › Microfone**, escolha "Os sites podem pedir para usar o microfone" (ou ligue "Perguntar primeiro") e tire `127.0.0.1:8765` dos bloqueados. |
| **O Android não deu o microfone ao Chrome** | **Configurações do Android › Apps › Chrome › Permissões › Microfone** › "Permitir só durante o uso do app", e recarregue. |
| **O pedido do microfone fechou** | O pedido sumiu sem resposta: toque no microfone de novo e escolha **Permitir**. |
| **O reconhecimento de voz recusou** | O site já tem o microfone; quem recusou foi o reconhecimento de voz do Android. Confira o app **Google** com a permissão do microfone (**Configurações do Android › Apps › Google › Permissões › Microfone**), se nenhum outro app está ouvindo (Assistente, teclado por voz, o Termux) e se o link está aberto no **Google Chrome**, e não em outro navegador. |
| **Reconhecimento de voz indisponível** | Não é o microfone. Abra o link no **Chrome** (não dentro de outro app que abre links) e confira se o app **Google** está instalado e ativo: o Chrome do Android usa a voz do Google para entender a fala. |
| **Sem acesso ao microfone** | Outro app está usando o microfone (gravador, ligação, o Termux gravando), ou o Chrome está sem a permissão do Android (veja acima). |
| **Sem conexão para entender a voz** | O reconhecimento do Chrome usa a internet. |

A porta é sempre a mesma (8765, a não ser que você use `--porta`), então a permissão dada uma vez vale nas próximas.

### Ouvir pelo Termux quando o navegador não deixa (v0.53.2)

Rodando o site no Termux, se o navegador recusar o microfone, o site passa a ouvir pelo app **Termux:API**, que tem
a sua própria permissão do microfone (o Chrome não entra). Na primeira vez aparece "agora eu ouço pelo Termux:API";
daí em diante, nesta aba, o microfone é o dele. Tocar de novo no microfone cancela.

- **Para funcionar:** instale o app **Termux:API** (da mesma loja de onde veio o Termux; o pacote sozinho não basta) e
  rode `pkg install termux-api`. Na primeira vez, o Termux:API pede a permissão do microfone: toque em **Permitir** e
  depois no microfone de novo.
- **Se o Termux não responder:** o aviso diz o caminho (o app instalado, a permissão em **Configurações do Android ›
  Apps › Termux:API › Permissões › Microfone**). Na próxima vez, o site tenta o navegador de novo.
- **Como é feito:** o servidor roda o `termux-speech-to-text` sem argumentos (nada da página entra no comando), só um
  por vez e nunca no meio de uma resposta, com prazo de 45 s. Fechar a página, tocar de novo ou "Parar" encerra o
  comando e o que ele abriu. Só o texto ouvido volta para a página, e ele não vai para o log. O programa só vale se
  estiver fora das pastas em que o agente grava (como o `bwrap`): um plantado no projeto não roda.

Sem o microfone, dá para digitar normalmente, e o "Ouvir" continua lendo as respostas.

## Só com a chave do Gemini (v0.52.0)

Para usar o site, basta a chave da API do Gemini. Não precisa de modelo local nem de configurar mais nada.

- **Sem chave:** a página mostra o cartão "Falta só a chave da API do Gemini", com o link para pegar uma de graça no
  Google AI Studio (aistudio.google.com/apikey). Cole a chave e toque em **Salvar e começar**.
  - **Conferida antes de salvar:** o servidor confere a chave com o Google, numa chamada que não gasta cota (a lista de
    modelos). Uma chave recusada não é salva.
  - **Sem internet:** a chave é salva sem conferir, e a primeira conversa confere.
  - **Onde fica:** no mesmo lugar do `gemini-code config set-key`. Ela nunca volta para a página nem aparece no log.
  - **Chave errada ou recusada no meio da conversa:** o cartão aparece de novo.
- **Com a chave:** a conversa vai direto para a nuvem. O modo híbrido (o padrão) mandaria as perguntas simples para um
  modelo local, que talvez nem esteja instalado. Um aliado com modelo próprio continua usando o dele.
- **Com senha mestra** (`apiKeyLocked`): a página não troca a chave. Use o terminal.
- **Com um aliado** (`--aliado treinador`): as sugestões da tela inicial são as dele, como "Monta o treino de amanhã…".
- **Criar imagem pela conversa:** "crie uma imagem de um café aconchegante para o feed". A imagem sai no formato da rede
  (feed 4:5, stories 9:16, YouTube 16:9) e aparece na conversa com o botão **Baixar**.
  - **Antes de criar:** a permissão aparece na página, porque gasta a cota da sua chave. Responda "sempre" para não
    perguntar de novo nesta execução.

## Modo até terminar (v0.52.0)

O botão **Até terminar**, no topo do chat (e embaixo, na página de voz), faz o agente trabalhar sozinho até a tarefa
estar pronta. Sem ele, o agente às vezes para no meio para perguntar "posso continuar?".

- **Como funciona:**
  - o agente conta quando acabou;
  - se ele parar antes, o gemini-code manda ele continuar de onde parou;
  - no fim, a resposta ganha um selo: **✓ Tarefa concluída**, **⚑ Precisa de você** (ele diz exatamente o que falta) ou
    o motivo de ter parado.
- **Os limites:**
  - **Continuações:** até 25. Duas respostas iguais seguidas (ou vazias), sem ferramenta no meio, também encerram.
  - **Passos:** até 400 (ferramentas e respostas), em vez de 60.
  - **O que continua valendo:** o **Parar** e as **permissões**.
- **Página fechada no meio:** nesse modo, o agente **continua**. Abra a página de novo para ver o que ele já fez: o texto,
  as ferramentas e as mídias. Uma permissão espera você voltar por até 30 minutos; depois conta como "não". Fora desse
  modo, fechar a página para o agente, como antes.
- **Também no terminal:**
  - `/ate-terminar` no chat;
  - `gemini-code run --ate-terminar "tarefa"`;
  - para começar sempre ligado: `gemini-code config set-ate-terminar on`.

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

## Foto, vídeo e áudio pela página (v0.51.0)

No chat, mande uma foto, um vídeo ou um áudio para o agente editar, e veja o resultado ali mesmo:

- **Mandar:** toque no **clipe** (no celular, abre a galeria ou a câmera). No PC, também dá para **arrastar** o arquivo para
  a conversa ou **colar** uma foto (Ctrl+V) na caixa de mensagem.
- **Subir:** o arquivo sobe na hora, com a barra de progresso, e aparece acima da caixa de mensagem. Escreva o que quer
  ("deixa pronta pro feed com o texto Promoção") e envie. Dá para mandar só o arquivo, sem texto.
- **Onde fica:** em `midia-recebida/`, na pasta do projeto, que já vem com um `.gitignore` para nada ir para o git. Um
  arquivo com o mesmo nome vira `-2` e nada é sobrescrito.
- **Limites:** até 1 GB por arquivo e 10 por mensagem.
- **Formatos:**
  - foto: jpg, png, webp, gif;
  - vídeo: mp4, mov, webm, mkv, 3gp;
  - áudio: mp3, m4a, aac, ogg, wav.
  - Foto HEIC ainda não: no iPhone, use Ajustes > Câmera > Formatos > "Mais Compatível".
- **O agente vê a foto,** como no `/imagem` do terminal: até uns 15 MB de fotos por mensagem. Ele também recebe o
  caminho de cada arquivo para editar.
- **Vídeo:** mandar um vídeo (ou um áudio, para a trilha) liga a ferramenta `video` nesta execução, porque ela é sob
  demanda. Num aliado, vale a lista de ferramentas dele.
- **Resultado:** a foto editada, o vídeo e a capa aparecem na resposta, com o botão **Baixar**. Um arquivo acima de
  150 MB só carrega a prévia quando você toca em "Mostrar".
- **Recarregar:** a conversa volta com as fotos e os vídeos no lugar.
- **Página de voz:** o que o agente criar também aparece embaixo da resposta.

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
- página fechada no meio = agente parado (ninguém olhando, nada de seguir usando ferramentas nem gastando cota). A
  exceção é o modo até terminar, que você ligou para isso (v0.52.0).
- **A chave pela página (v0.52.0):**
  - a rota exige a mesma chave da sessão e as mesmas travas de origem e de `Host`;
  - aceita só o formato de uma chave do Gemini;
  - limites: uma conferência por vez e até 10 tentativas a cada 10 minutos;
  - a chave nunca volta nas respostas nem vai para o log;
  - a conferência só fala com o endereço fixo do Google e não segue redirecionamento.
- **Troca de aliado (v0.53.0):** pela mesma chave da sessão. Só para um aliado que existe, nunca no meio de uma
  resposta, e a conversa começa do zero: o histórico de um aliado não vai para outro. As ferramentas são as do aliado,
  como no `--aliado`.
- **Envio de arquivo (v0.51.0):**
  - É a única rota que não é JSON. Exige a mesma chave e passa pelas mesmas travas de origem e de `Host`.
  - Só aceita os tipos de foto, vídeo e áudio da lista. Os tipos que outro site consegue mandar sem pedir licença ao
    navegador (`text/plain`, formulário) são recusados, e o servidor confere os primeiros bytes: uma página HTML
    chamada de foto não entra.
  - O nome do arquivo é limpo: só o nome, nunca uma pasta; a extensão vem do tipo, não do nome. O arquivo é recebido num
    temporário: um envio cortado no meio não deixa nada pela metade.
  - Se `midia-recebida` for um link para outro lugar (num projeto baixado da internet, por exemplo), o envio é recusado.
- **Prévias:** a página só mostra arquivos que este servidor registrou, recebidos ou criados nesta conversa. Na hora de
  mostrar, ele confere de novo: um arquivo trocado por um link, ou dentro das pastas de segredos do gemini-code (saúde,
  redes), não sai. A prévia é um `blob:` local; nada carrega de fora.

## Limites honestos

- Testado com um Chromium de verdade (a página sobe, a esfera desenha, a conversa vai e volta, as permissões aparecem)
  e com a voz **simulada**: este ambiente não tem microfone nem alto-falante. A qualidade do reconhecimento depende do
  navegador e do microfone.
- O estilo da esfera é inspirado nos assistentes de filmes de ficção; o desenho é próprio.
- A versão chat foi testada num Chromium de verdade, de ponta a ponta: resposta formatada, ferramenta, permissão no
  meio, recarregar e parar. Também passou por prints no tema claro, no escuro e no celular. O Markdown é um subconjunto
  do dia a dia; um recurso raro (HTML, nota de rodapé, título sublinhado) aparece como texto.
- Foto e vídeo pela página (v0.51.0):
  - **Testado** num Chromium de verdade com a tela de um Pixel 7, de ponta a ponta: mandar a foto e o vídeo, editar com
    as ferramentas de verdade, ver o resultado, baixar e recarregar.
  - **Não testado:** o navegador de um celular de verdade (Chrome do Android, Safari do iPhone).
  - **Prévia na memória:** a prévia de um vídeo grande é carregada inteira na memória do navegador.
  - **Arquivos ficam:** "Nova conversa" tira as prévias da página; os arquivos continuam em `midia-recebida/`.
- A chave e o modo até terminar (v0.52.0):
  - **Testado:** num Chromium de verdade, com um Gemini **falso**, porque este ambiente não tem internet nem modelo de
    IA: o cartão da chave, salvar e conversar, o botão "Até terminar" e a página que volta no meio.
  - **Não testado:** uma chave de verdade conferida com o Google, e o modelo real seguindo as marcas de fim.
- Um site só (v0.53.0):
  - **Testado:** num Chromium de verdade, de ponta a ponta:
    - trocar de aliado no topo, e a mensagem ir para ele;
    - ditar pelo microfone, com a mensagem indo sozinha e a resposta falada;
    - o "Ouvir" e o parar;
    - ir para o modo voz e voltar com a mesma conversa.

    O comando `site` foi testado de verdade, com a lista de aliados do usuário.
  - **Simulados:** o reconhecimento e a síntese de voz, porque aqui não há microfone, alto-falante nem internet.
  - **Não testado:** o microfone de um celular de verdade.
- O microfone de verdade e o Termux (v0.53.2):
  - **Testado:** num Chromium de verdade, com o pedido do microfone **simulado** (cada recusa: o site, o Android, o
    pedido fechado, o reconhecedor) e com um Termux **falso** no servidor: o Chrome recusa, o site ouve pelo Termux, a
    mensagem vai sozinha, tocar de novo cancela e o servidor encerra o comando, no chat e na esfera. O
    `termux-speech-to-text` foi trocado por scripts de verdade: o último parcial, o pedido de permissão, o prazo e o
    cancelar, sem deixar processo órfão.
  - **Não testado:** o Chrome e o Termux:API de um celular de verdade. Em algumas versões do Android, o reconhecimento
    pelo Termux:API pode não ouvir com o Chrome na frente; nesse caso o aviso diz o que conferir.
