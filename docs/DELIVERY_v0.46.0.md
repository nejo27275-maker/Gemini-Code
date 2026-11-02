# Entrega v0.46.0 — saúde, compras do mês, imagem, vídeo, câmera, TV e criar site/app

- **Saúde** (`gemini-code saude`, guia `docs/SAUDE.md`): diário de pressão, glicemia, peso/IMC, temperatura, saturação, batimentos, sintomas e remédios, com faixas de referência para adultos (SBC 2020, SBD, OMS) testadas nos limites. Triagem de emergência por regras fixas, antes do modelo, sempre com 192/193/188/0800 722 6001. Lembretes de remédio viram rotinas `lembrete`. Página para levar à consulta, sem script e sem nada da internet. Aliado `saude`. Os dados ficam em `SAUDE_DIR`, que as ferramentas de arquivo não leem nem gravam (`SECRET_DIRS`, novo). Não diagnostica nem receita.
- **Rotina `lembrete`:** só uma notificação no horário, sem IA.
- **Compras do mês** (`gemini-code compras`): lista por seção, frequência mensal/quinzenal/semanal, preços e orçamento. `compras ifood` copia a lista e abre o iFood; o pedido e o pagamento ficam com você no app. O iFood não tem uma forma oficial para pedidos de fora, e o gemini-code não paga, não entra na conta e não guarda senha nem cartão.
- **Imagem** (`gemini-code imagem`, ferramenta `imagem`): gerar e editar com IA (pergunta antes, por causa da cota), melhorar sem IA pelo ImageMagick ou com IA, e descrever imagens do disco.
- **Vídeo** (`gemini-code video`): melhorar e slideshow pelo ffmpeg, gerar com Veo. Corrigido: o segundo vídeo apagava o primeiro (era sempre `video.mp4`).
- **Câmera** (`gemini-code camera`): foto, analisar e vigiar (detecta movimento sem IA e notifica). A ferramenta `camera` pergunta **toda** vez.
- **TV** (`gemini-code tv`): diagnóstico só de leitura; otimizar pergunta a cada passo (animações 0,5x, cache, apps em segundo plano). Nunca desinstala.
- **Criar** (`gemini-code criar site|app`, skill `criar-site-e-app`): site responsivo ou app PWA que funciona offline. `criar servir` atende só em 127.0.0.1, sem sair da pasta.
- **Ferramentas sob demanda:** `saude_*`, `camera`, `video` e `compras` só entram num aliado que as use ou com `config ferramentas-extras`.
- **Corrigido:** skills com `description: >` (bloco YAML) chegavam ao agente como ">".
- **Testes:** 906 no Node 20 e no 22, com a sandbox real; 905 passam e 1 é pulado como root. ImageMagick e ffmpeg rodaram de verdade. As páginas de saúde, do site e do app foram abertas num Chromium. ESLint 0 problemas.
- **CI:** 906/906 nos Node 20, 22 e 24, nenhum pulado. O CI agora instala ImageMagick e ffmpeg, e com `GEMINI_CODE_EXIGIR_MIDIA=1` os testes de mídia falham em vez de pular.
- **Não testado aqui:**
  - IA de verdade (este ambiente não tem chave nem acesso ao Google): gerar/editar imagem, descrever, Veo e analisar foto;
  - câmera real: os testes usam uma câmera simulada;
  - TV real: os testes usam um adb falso.
