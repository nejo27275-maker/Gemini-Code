# Editar como um profissional: código, vídeo e foto (v0.50.0)

O gemini-code edita **código**, **vídeo** e **foto** do jeito de um profissional. Tudo roda no aparelho:

- código, com as ferramentas de arquivo;
- vídeo, com o ffmpeg;
- foto, com o ImageMagick.

Nada disso usa IA nem gasta a cota da sua chave.

## Código

| O que o agente faz | Por quê |
| --- | --- |
| **Lê antes de sobrescrever.** O `write_file` recusa sobrescrever um arquivo que o agente não leu nesta sessão, ou que mudou no disco depois da leitura. | Ele nunca apaga, sem ver, uma mudança que você fez no editor (ou que um comando fez). |
| **Mostra o que mudou.** Cada edição volta com o diff e os números de linha. | O agente confere o resultado sem ler o arquivo de novo, e você vê exatamente o que mudou. |
| **Confere a sintaxe** de `.js`, `.json`, `.py` e `.sh` depois de editar. | Se a edição quebrou o arquivo (e antes estava certo), ele fica sabendo na hora e corrige. |
| **Mantém o estilo do arquivo:** o fim de linha (CRLF do Windows) e o BOM. | Uma edição pequena não vira um arquivo inteiro "mudado" no git. |
| **Acha o trecho mesmo com espaço sobrando no fim da linha.** Quando não acha, mostra o trecho mais parecido, com os números de linha. | Menos tentativas erradas. |
| **Edita vários arquivos de uma vez** (`edit_files`). Ou tudo dá certo, ou nada é gravado. | Uma refatoração nunca fica pela metade. |

Detalhes:

- **Conferir a sintaxe só analisa.** O código não roda:
  - JavaScript: `node --check`;
  - Python: `ast.parse`;
  - shell: `bash -n`.
- **Conferidores confiáveis:** o `python3` e o `bash` vêm das pastas do sistema, nunca de uma pasta onde o agente grava.
- **Desligar a conferência:** `gemini-code config set-conferir-sintaxe off`.
- **Desfazer:** `/rewind` no chat volta o último turno; `gemini-code backups ARQUIVO` lista as cópias de antes.
- **Aprovar cada edição:** com `/passo` ligado no chat, antes de gravar o agente mostra o diff de verdade, com números de
  linha, e pergunta. Num arquivo de segredo do gemini-code, a prévia nunca mostra o conteúdo.

## Vídeo: `gemini-code video editar`

A receita inteira é aplicada numa passada só:

```bash
gemini-code video editar viagem.mp4 \
  --cortar 0:05-0:35 --formato reels --cor quente \
  --texto "Fim de semana na praia" --posicao-texto topo --fundo \
  --legenda falas.srt --musica fundo.mp3 --marca logo.png --fade 0.5
```

| Opção | O que faz |
| --- | --- |
| `--cortar 0:05-0:35` | Mantém só esse trecho (também `5-35` ou `0:05 até 0:35`). |
| `--formato reels\|feed\|quadrado\|youtube` | Reels/TikTok/Shorts/Stories em 9:16 (1080x1920), feed do Instagram em 4:5, quadrado em 1:1, YouTube em 16:9. |
| `--enquadrar fundo-desfocado\|preencher\|barras` | Como caber no formato. O padrão põe o próprio vídeo, desfocado, no fundo. |
| `--cor natural\|vivo\|quente\|frio\|cinema\|pb\|vintage\|dramatico` | Cor pronta. Para ajuste fino: `--brilho -1..1`, `--contraste 0..3`, `--saturacao 0..3`. |
| `--texto "…"` (pode repetir) | Texto na tela, quebrado em linhas e centralizado. `--posicao-texto topo\|centro\|baixo`; `--fundo` põe uma faixa escura atrás. |
| `--legenda falas.srt` | Queima a legenda no vídeo (`.srt`, `.vtt` ou `.ass`). Os tempos são os do vídeo **original**: o corte e a velocidade são aplicados na legenda também. |
| `--musica fundo.mp3` | Música de fundo. Quando alguém fala, ela abaixa sozinha. Volume: `--volume-musica 0.25`. |
| `--marca logo.png` | Marca d'água num canto (`--posicao-marca`). |
| `--velocidade 1.25` | De 0,25x a 4x, com o áudio no tom certo. |
| `--fade 0.5` | Entra e sai suave, na imagem e no som. |
| `--estabilizar`, `--melhorar` | Tira a tremedeira; menos ruído e mais nitidez. |
| `--qualidade alta\|normal\|leve` | `leve` é para o WhatsApp (até 720p). |
| `--sem-normalizar` | Por padrão, o áudio sai no volume que as redes usam (-14 LUFS). Isto desliga. |

Vídeo **HDR** (iPhone e celular top de linha gravam assim) sai convertido para cores normais (SDR). Sem a conversão, ele
ficaria desbotado no Instagram e no WhatsApp. Vale também no `juntar` e na `capa`, e o `info` mostra quando o vídeo é
HDR. A conversão precisa do filtro `zscale` no ffmpeg; sem ele, o resultado avisa. Vídeo gravado com o celular em pé
sai em pé.

Outros comandos:

```bash
gemini-code video juntar abertura.mp4 meio.mp4 fim.mp4 --transicao suave --formato reels
gemini-code video capa viagem.mp4                 # a melhor imagem do começo, em .jpg
gemini-code video capa viagem.mp4 --tempo 0:12    # a imagem desse instante
gemini-code video audio viagem.mp4                # só o som, em .mp3
gemini-code video info viagem.mp4                 # duração, tamanho, áudio
```

Sempre sai um arquivo novo. Para escolher o nome, use `--saida novo.mp4`; se o nome já existir, vira `novo-2.mp4`.

## Foto: `gemini-code imagem ajustar`

```bash
gemini-code imagem ajustar loja.jpg --formato feed --cor vivo --melhorar \
  --texto "50% OFF só hoje" --posicao-texto topo --fundo --marca logo.png
gemini-code imagem ajustar *.jpg --formato quadrado --cor quente   # várias de uma vez
gemini-code imagem ajustar foto.jpg --qualidade leve                # menor, para o WhatsApp
```

- **Formatos:**
  - `feed`: 4:5, 1080x1350;
  - `quadrado`: 1080x1080;
  - `stories`: 9:16, 1080x1920;
  - `youtube`: capa, 1280x720.
- **Enquadrar:** como no vídeo.
- **Ajustes:** as mesmas cores do vídeo, mais `--nitidez 0..3` e `--melhorar`, que corrige luz, cor e nitidez sozinho.
- **Localização:** por padrão, a foto sai **sem a localização e sem os dados da câmera** (EXIF), depois de ser endireitada. Para manter, use `--manter-localizacao`.
- **Marca d'água no canto:** o texto daquele lado sobe para não ficar em cima dela.

## Pedindo para o agente

No chat, é só pedir. Exemplos:

- "corta o vídeo.mp4 do 0:05 ao 0:35, deixa no formato do Reels com a legenda falas.srt e a música fundo.mp3"
- "junta esses três vídeos com transição suave"
- "deixa essa foto no formato do feed, com cor viva e o texto 'Promoção de sábado' em cima"

Duas ferramentas fazem esse trabalho:

- **`imagem`, ação "ajustar":** já vem ligada.
- **`video`:** é sob demanda. No chat comum, ligue com `gemini-code config ferramentas-extras video`. Num aliado, ela vem com o preset "midia".
  No modo site, ela liga sozinha quando você manda um vídeo pela página (v0.51.0).

**Pelo navegador (v0.51.0):** `gemini-code site --chat --abrir`, toque no clipe e mande a foto ou o vídeo. O resultado
aparece na conversa, com o botão Baixar. Veja [MODO_SITE.md](MODO_SITE.md).

## Cores e volume certos (v0.51.0)

- **Foto de iPhone (Display P3):**
  - **Antes:** tirar a localização (o padrão) tirava também o perfil de cor da foto. O app passava a ler a foto como
    sRGB, e as cores desbotavam.
  - **Agora:** a foto é convertida para sRGB antes, como um editor faz ao exportar para a internet. O vídeo de fotos
    (`slideshow`) também converte: o ffmpeg ignora o perfil de cor.
  - **Sem o lcms no ImageMagick:** a localização sai e o perfil de cor fica. O perfil sRGB é montado pelo próprio
    gemini-code (`src/perfilCor.js`), porque nem todo aparelho tem um arquivo `.icc`.
- **Vídeo HDR no "melhorar":** como o `editar` já fazia, converte para cores normais (SDR BT.709).
- **Volume das redes em duas passadas:** depois de exportar, mede o volume de verdade.
  - **Por quê:** numa passada só, um vídeo curto com som de mar parava em -15/-16 LUFS dizendo -14.
  - **Como corrige:** se passou de 1 LU da meta, refaz só o áudio (ganho e limitador de pico). O vídeo é copiado, sem
    perder qualidade.
- **GIF animado:** vira uma foto só (o primeiro quadro). Antes, as medidas saíam erradas e o resultado virava vários
  arquivos.

## Segurança

- **Texto no vídeo:** vai por arquivo para o ffmpeg, nunca dentro do filtro. Um `%{...}` aparece como texto e não vira comando.
- **Texto na foto:** é escapado para o ImageMagick. Um `@` no começo não lê arquivo, e `%w` não vira a largura.
- **Entradas e saídas:**
  - as entradas passam pelas mesmas travas de sempre: nada dos arquivos protegidos do gemini-code;
  - no vídeo, só arquivo local (`-protocol_whitelist file`);
  - a saída é sempre um arquivo novo, fora das áreas protegidas.
- **Sessão de convidado (cowork):** só usa arquivos de dentro do projeto.
