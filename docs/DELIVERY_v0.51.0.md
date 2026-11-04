# Entrega v0.51.0 — foto e vídeo pelo modo site, e cores e volume certos

- **O mesmo erro das cores, em mais três lugares** (cada um com um teste que falha no código anterior):
  - **`video melhorar` com vídeo HDR:**
    - **antes:** saía em 8 bits ainda marcado como HDR (desbotado);
    - **agora:** converte para SDR BT.709, como o `editar`.
  - **Foto de iPhone (Display P3) no `imagem ajustar`:**
    - **antes:** tirar a localização tirava o perfil de cor, e um vermelho (200,60,40) aparecia assim em vez de
      (217,42,23);
    - **agora:** converte para sRGB antes;
    - o perfil sRGB é montado no código (`src/perfilCor.js`) e confere com o do lcms: diferença 0 num degradê de
      16.384 pixels.
  - **Foto P3 no vídeo de fotos (`slideshow`):** o ffmpeg ignora o perfil; agora a foto entra convertida.
- **Volume das redes em duas passadas:**
  - **antes:** o `editar` e o `juntar` diziam -14 LUFS, mas um vídeo curto com som de mar saía em -15,5/-16,3;
  - **agora:** mede depois de exportar e, se passou de 1 LU, refaz só o áudio. O Reels da demonstração foi de -16,3 para
    -14,5 LUFS.
- **GIF animado no `ajustar`:** vira uma foto só (antes, medidas erradas e erro).
- **Modo site com foto, vídeo e áudio (chat):**
  - **Mandar:** pelo clipe, arrastando ou colando. O arquivo sobe com progresso, para `midia-recebida/`, e nunca
    sobrescreve.
  - **O agente:** vê a foto, e mandar um vídeo liga a ferramenta `video` nesta execução.
  - **O resultado:** aparece na resposta com **Baixar** e volta ao recarregar. A página de voz também mostra.
- **Segurança do envio:**
  - a mesma chave, Origin e Host;
  - só tipos de mídia (nada que outro site mande sem pedir licença), conferidos pelos primeiros bytes;
  - nome limpo, até 1 GB, um envio por vez, temporário apagado se cortar no meio;
  - `/api/midia` só serve o que o servidor registrou, conferido de novo na hora (nada de segredo, nada de link).
- **Testes:** +25 (15 do modo site com mídia, 3 dos perfis de cor, 3 de foto, 4 de vídeo).
- **Suíte inteira:** 1082 testes no Node 22, no 20 e no fuso de São Paulo (1081 passando, 1 pulado como root).
  Depois do último ajuste, os 6 arquivos de teste da mídia e do modo site rodaram de novo nos três: 79/79.
- **Checagens:** ESLint com 0 problemas, varredura de segredos limpa e autoteste das avaliações 7/7.
- **Demonstração:**
  - **Material:** foto e vídeo desenhados aqui (sem internet).
  - **De verdade:** a edição, o envio e a página, num Chromium com a tela de um Pixel 7.
  - **Roteiro:** o texto do agente, porque aqui não há modelo de IA.
  - **Entregue:** a foto e o vídeo editados e os prints.
