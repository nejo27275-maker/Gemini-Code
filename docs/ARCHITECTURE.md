# Arquitetura do gemini-code

Visão geral de como as peças do projeto se encaixam. Para o que cada
comando faz do ponto de vista do usuário, veja o `README.md`; este
documento é sobre como o código por trás disso está organizado.

## Ponto de entrada

- **`bin/gemini-code.js`** — CLI: interpreta os argumentos (`chat`, `run`,
  `agent run`, `design`, `media`, `voice`, `cowork`, `skills`, `config`,
  etc.) e chama as funções correspondentes no resto do projeto.

## Núcleo do agente

- **`src/agent.js`** — o loop agentivo em si: monta a instrução de sistema
  (incluindo as skills disponíveis), manda a conversa pro Gemini junto com
  a lista de ferramentas (`src/tools`), executa qualquer `tool_call` que o
  modelo pedir e repete até a resposta ser só texto. Também poda o
  histórico de conversas longas (`podarHistorico`) para não estourar o
  contexto do modelo.
- **`src/provider.js`** — roteador que o agente chama no lugar de falar com
  um modelo direto: por padrão usa `llama.cpp` (`src/providers/llamacpp.js`)
  para inferência GGUF local sem Ollama; também suporta Gemini, `hybrid`,
  compatibilidade opcional com Ollama e `code-ia` como modo limitado. Aceita
  `modelName` explícito (`@local`, `@cloud`, `llamacpp:X`, `ollama:X`) e, no
  modo híbrido, troca de lado em falhas recuperáveis (só se nada foi impresso).
  Os dois provedores devolvem o mesmo objeto (`text()`, `functionCalls()`,
  `rawParts()`), e o histórico é sempre guardado no formato Gemini — o
  provedor local converte na hora de enviar.
- **`src/gemini.js`** — cliente HTTP puro para a API do Gemini
  (`chatWithTools`).
- **`src/providers/llamacpp.js`** — cliente local compatível com a API OpenAI
  (`/v1/chat/completions`) do `llama-server`, sem Ollama.
- **`src/providers/ollama.js`** — cliente opcional de compatibilidade com Ollama
  (`/api/chat`, streaming NDJSON) para instalações antigas.
- **`src/navegador.js`** — navegador do agente (v0.44.0): Chrome/Chromium/Edge sem
  janela, comandado pelo protocolo DevTools por um pipe (sem porta aberta), perfil
  temporário e todo o tráfego por um proxy que confere o endereço na hora de conectar.
  A ferramenta que o modelo usa é `src/tools/browserTools.js` (`browser`).
- **`src/sandbox.js`** — sandbox do `run_shell` (v0.45.0, Linux): monta a chamada do
  bubblewrap (disco só leitura menos o projeto, `.git` só leitura, segredos e credenciais
  invisíveis, sem rede, `/tmp` descartável) e o filtro seccomp (BPF montado em JS) que nega
  socket `AF_UNIX`, io_uring e o chaveiro do kernel. `src/tools/shellTools.js` decide quando
  usar: o que roda sem uma pessoa aprovar na hora vai para a sandbox. Guia: `docs/SANDBOX.md`.
- **v0.46.0** — `src/saude.js` + `src/saudeCommands.js` (assistente de saúde: diário, faixas de
  referência, triagem de emergência por regras, remédios com lembrete, página para a consulta; guia
  `docs/SAUDE.md`), `src/compras.js` + `src/comprasCommands.js` (lista do mês e a ponte para o iFood),
  `src/imagem.js` (gerar/editar/melhorar/descrever; ImageMagick ou Gemini), `src/video.js` (ffmpeg e Veo),
  `src/camera.js` (Termux:API/webcam e vigia), `src/tvOtimizar.js` (diagnóstico e otimização da TV),
  `src/criador.js` (site/app PWA e o servidor local), `src/schemaGemini.js` (v0.45.1) e `src/abrir.js`
  (abrir arquivo/link e copiar). Ferramentas novas: `imagem` (sempre) e, sob demanda, `saude_*`,
  `camera`, `video` e `compras` (só quando a lista de ferramentas de um aliado as cita).
- **v0.47.0** — `src/redes.js` + `src/redesCommands.js` (redes sociais pelas APIs oficiais: contas em
  `~/.gemini-code/redes/`, plano → publicação em paralelo, menções, links de compartilhar; guia
  `docs/REDES_SOCIAIS.md`), `src/computador.js` (mouse, teclado, print e janelas por sistema; comandos montados
  por uma função pura), `src/desafios.js` + `src/desafiosCommands.js` (desafios com lembrete que se encerra),
  `src/datas.js` (data digitada por uma pessoa, sem adivinhar). Ferramentas sob demanda novas: `redes`,
  `computador`, `desafio`; o `adb` ganhou `ui`/`tocar`/`deslizar`/`segurar` e o `browser`, `selecionar`/`esperar`,
  janela visível e o aviso de verificação humana. Guia de controle: `docs/CONTROLE.md`.
- **v0.48.0** — `src/site/servidor.js` + `src/site/publico/` (modo site: servidor local com chave por execução,
  Host/Origin conferidos e CSP fechada; a página com a esfera animada em canvas, reconhecimento e síntese de voz do
  navegador e a conversa em eventos NDJSON; as confirmações das ferramentas chegam à página pelo
  `definirPerguntador` de `src/ui/prompt.js`). Guia: `docs/MODO_SITE.md`.
- **v0.48.1** — "Parar" de verdade: `runOnce({ signal })` (src/agent.js) para no próximo ponto seguro (não chama o
  modelo de novo, não roda a próxima ferramenta — que recebe a resposta "não rodou" — e não espera a resposta que
  está chegando); os provedores repassam o signal ao `fetch` e, depois dele, não repetem, não trocam de lado nem
  ligam o llama.cpp. O modo site usa por `/api/parar` (botão/Esc) e quando a página fecha no meio.
- **v0.49.0** — versão chat do modo site: `src/site/publico/chat.{html,js,css}` (conversa comum, por texto) e
  `src/site/publico/comum.js` (chave, API, eventos e o Markdown seguro, usado pelas duas páginas: análise pura em blocos
  e montagem elemento por elemento, sem HTML). `/api/historico` (`paraExibicao` em `src/site/servidor.js`) devolve a
  conversa para a página ao recarregar; `gemini-code site --chat`.
- **v0.49.1** — `src/emAndamento.js`: os comandos de terminal em primeiro plano (`run_shell`, `run_checks`, direto ou na
  sandbox) ficam registrados. O Ctrl+C e o "Parar" os interrompem como um terminal (SIGINT na árvore, SIGKILL em 2 s)
  e, ao sair, nenhum fica órfão. No chat do terminal, um ouvinte de `SIGINT` na readline compartilhada para a resposta
  (`runOnce({ signal })`) e cancela a confirmação aberta (`cancelarPerguntas` em `src/ui/prompt.js`).
- **v0.49.2** — `pastaDoUsuario()` (src/config.js): a pasta do usuário é sempre um caminho absoluto. Com `HOME` vazio, a
  config ia para a pasta atual e a sandbox escondia as credenciais erradas. Também usada no `localServer.js` e nos
  padrões da sandbox. No chat: Ctrl+C com texto só apaga a linha, e Ctrl+D sai pelo `encerrarComLimpeza`.
- **v0.49.3** — o resto do código também usa `pastaDoUsuario()`: `config add-pasta-gravavel`, `foraDaAreaDeTrabalho`
  (src/tools/protectedPaths.js), os checkpoints, o `computador`, o navegador, o `doctor` e o `sandbox status`. Não há
  mais `os.homedir()` fora de src/config.js.
- **v0.50.0** — editar como um profissional:
  - **Código:**
    - `src/tools/edicao.js` é o motor do `edit_file`/`edit_files`, que agora usam o mesmo núcleo
      (`multiEditTools.editar`). Ele mantém o fim de linha, tolera espaços no fim das linhas, sugere o trecho mais
      parecido e gera o diff com números de linha.
    - `src/tools/leituras.js` guarda o que o agente leu ou gravou: o `write_file` não sobrescreve o que não leu nem o
      que mudou depois.
    - `src/tools/sintaxe.js` confere a sintaxe depois da edição: só analisa, pela entrada padrão, com `python3`/`bash`
      achados por `acharProgramaConfiavel` (src/sandbox.js).
  - **Vídeo:** `src/videoEdicao.js` (ffmpeg) monta a receita num filtro só (`montarEdicao`) e tem `juntar`, `capa`,
    `extrairAudio` e `info`.
  - **Foto:** `src/imagemEdicao.js` (ImageMagick) faz o "ajustar", com o texto escapado por `textoMagick`.
- **v0.50.1** — o vídeo HDR (HLG/PQ) é convertido para SDR BT.709 (`cadeiaSdr`, `zscale` + `tonemap`) no editar,
  no juntar e na capa; a prévia do `/passo` (`src/stepApproval.js`) mostra o diff de verdade, sem nunca ler um segredo.
- **v0.51.0** — foto e vídeo pelo modo site, e cores e volume certos:
  - **Envio:** `src/site/servidor.js` ganhou `/api/enviar`, que recebe o arquivo cru (tipos da lista, conferidos pelos
    primeiros bytes) em `midia-recebida/` (`salvarCorpo`, `publicar`, `nomeDoEnvio`).
  - **Prévias:** `/api/midia` serve só o que o servidor registrou (`registrarMidia`). O evento `midia` vem de
    `src/midiaGerada.js`: as ferramentas `imagem`, `video` e `camera` avisam o arquivo que criaram.
  - **Páginas:** `comum.js` faz o envio com progresso (`enviarArquivo`) e o cartão de mídia (`cartaoMidia`); o chat
    tem a bandeja de envio e as prévias.
  - **Ferramenta de vídeo:** `src/tools/index.js` ganhou `ligarNaSessao` (só o `video`).
  - **Cor da foto:** `src/perfilCor.js` monta perfis ICC v4. O `imagem ajustar` e o slideshow convertem foto Display P3
    para sRGB.
  - **Vídeo:** `video melhorar` converte o HDR, e `afinarVolume` (src/videoEdicao.js) mede o volume e corrige em duas
    passadas.
- **v0.52.0** — o site só com a chave do Gemini, criar imagem, o modo até terminar e o treinador de futebol:
  - **Chave pela página:** `src/site/servidor.js` ganhou `/api/chave` (`chavesPadrao`: `estado`, `validar` pela lista de
    modelos do Google, `salvar`). O `/api/historico` diz se falta a chave (`precisa`).
    - **Na página:** `comum.js` monta o cartão (`cartaoChave`).
    - **O modelo:** `modeloDoSite` manda as conversas do site para `@cloud` quando há chave (o híbrido iria para o
      modelo local).
  - **Criar imagem:** `imagem.gerar` aceita o formato da rede (`proporcao` → `imageConfig.aspectRatio` em
    `gemini.generateImage`), e o erro `limit: 0` da imagem fala do modelo de imagem (`config set-image-model`).
  - **Modo até terminar:** `runOnce({ ateTerminar })` em `src/agent.js` (marcas de fim, `CONTINUAR_ATE_TERMINAR`,
    tetos, `filtrarMarcas` no streaming).
    - **Terminal:** `/ate-terminar`, `run --ate-terminar` e `config set-ate-terminar`.
    - **Site:** o botão, a página que volta no meio (`andamento`) e as perguntas que esperam até 30 minutos.
  - **Futebol:** `src/futebol.js` (biblioteca, treino, semana, carga, prancheta), a ferramenta sob demanda
    `src/tools/futebolTools.js`, o comando `src/futebolCommands.js` e o preset `futebol` dos aliados.
- **v0.53.0** — um site só:
  - **Servidor:** `criarServidorSite` ganhou a opção `aliados` (`listar`, `abrir`) e a rota `/api/aliado`. O
    `/api/historico` lista os aliados. O comando `site` liga a lista à pasta de aliados do usuário.
  - **Chat (`chat.js`):** o microfone dita (reconhecimento do navegador), cada resposta tem "Ouvir", o seletor de aliado
    fica no topo, e "Modo voz" leva à esfera com a mesma conversa.
  - **Voz compartilhada:** a fala está em `comum.js` (`paraFala`, `frases`, `falar`, `pararFala`); a página de voz
    (`app.js`) usa o mesmo texto para a fala.
  - **Abertura:** `gemini-code site --abrir` abre o chat completo, e `--voz` abre direto na esfera.
- **v0.53.2** — o microfone de verdade:
  - **Páginas:** `comum.js` `pedirMicrofone` faz o pedido padrão (`getUserMedia`) antes do reconhecimento e solta o
    microfone na hora. `codigoDoErroDeMicrofone` traduz o motivo (o site, o Android, o pedido fechado), e
    `mensagemDeErroDeVoz` dá o caminho de cada um, inclusive o do Chrome inteiro e o do reconhecedor do Android.
  - **Termux:** quando o navegador recusa, `ouvinteDoAparelho` chama `/api/ouvir`. No servidor, `ouvirPadrao` acha o
    `termux-speech-to-text` com `acharProgramaConfiavel` e `ouvirCom` roda-o com prazo, cancelamento e morte dos
    descendentes. `lerSaidaDoTermux` fica com o último parcial e reconhece o pedido de permissão do Termux:API.
  - **Proxy do navegador:** `criarProxy` cancela o pedido de saída quando a página desiste dele.
- **`src/routineRunner.js`** — executor das rotinas: `http-check` e, desde a v0.44.0,
  `agente` (o agente roda sozinho; `src/ui/prompt.js` responde "não" a toda confirmação).
- Os provedores `llamacpp`, `ollama` e `openai` pedem **sempre** em streaming; o
  `onText` só decide se os pedaços aparecem enquanto chegam. Assim o tempo limite de
  cada um vale para inatividade, e não para a resposta inteira, também no `run`, no
  cowork, nos subagentes e nos workflows (v0.43.4).
- **`src/knowledge.js`** — conhecimento fixo (`~/.gemini-code/knowledge`,
  `GEMINI.md`/`AGENTS.md` do projeto) injetado no prompt do sistema por
  `buildSystemInstruction`.
- **`src/config.js`** / **`config-manager.js`** — leitura/escrita da
  configuração do usuário (chave de API, modelo padrão, etc.), guardada em
  `~/.gemini-code/`.

## Ferramentas (`src/tools/`)

Cada arquivo expõe um conjunto de "tools" que o modelo pode chamar durante
o loop do agente:

- `fileTools.js` — ler, escrever e editar arquivos.
- `adbTools.js` (v0.43.0) — controla aparelhos Android do usuário (TV, celular) por adb: execFile
  com lista de argumentos nesta máquina e, para o shell do aparelho (que recebe os argumentos do
  `adb shell` juntados sem escape), cada argumento entre aspas simples (`noAparelho`). Ações que
  mudam o aparelho pedem confirmação; as sensíveis (e o shell livre) sempre. Comando `gemini-code adb`
  e guia `docs/TV_ADB.md`.
- `../ui/textoSeguro.js` (v0.43.2) — `paraExibir`: todo texto de modelo/arquivo/servidor mostrado numa
  pergunta de confirmação passa por aqui (controles e direção bidirecional ficam visíveis).
- `shellTools.js` — rodar comandos de shell, com confirmação do usuário via
  a readline compartilhada (`src/ui/prompt.js`).
- `searchTools.js` — busca (web e/ou local, conforme configurado).
- `designTools.js` / `mediaTools.js` — geração de slides/documentos/imagem
  e a estrutura para vídeo (Veo) e áudio (Lyria).
- `mcpClient.js` — conecta a servidores MCP externos (`mcp.example.json`) e
  expõe as ferramentas deles ao agente do mesmo jeito que as nativas.
- `index.js` — agrega tudo isso na lista de tools que `src/agent.js` passa
  pro Gemini.

## Interface e integrações

- **`src/ui/prompt.js`** — uma única `readline.Interface` por processo,
  compartilhada entre o chat e a confirmação de `run_shell`, para evitar
  duas interfaces competindo pelo mesmo stdin (ver comentário no arquivo).
- **`src/voice/voice.js`** — fala, reconhecimento de voz e câmera via
  Termux:API; toda função checa `isTermuxApiAvailable()` primeiro e cai
  num fallback claro quando o pacote não está instalado.
- **`src/live/live.js`** — modo "ao vivo" (voz contínua, ver README).
- **`src/cowork/{client,server}.js`** — o par cliente/servidor do "Gemini
  Cowork": o celular manda instruções pro PC (mesma rede local) e o PC
  roda o agente. **`src/cowork/canalSeguro.js`** (v0.43.0) é o protocolo 2:
  X25519 efêmero + provas HMAC do token nos dois sentidos + AES-256-GCM com
  contador por direção (o token nunca passa pela rede). `criarConexao` (servidor)
  e `criarConexaoCliente` não dependem do WebSocket; `startServer`/`connect` só
  ligam os eventos do `ws` a elas. `admitir` decide antes do aperto de mão
  (IP bloqueado por tokens errados, teto de conexões).
- **`src/limitador.js`** (v0.43.0) — contador por chave numa janela de tempo,
  com memória limitada; usado pelo cowork e pela API de rotinas.

## Skills e automações

- **`src/skills/loader.js`** + pasta `skills/` — carrega arquivos
  `SKILL.md` que o agente consulta quando relevante (listados na instrução
  de sistema montada por `src/agent.js`).
- **`src/agents/runner.js`** — o comando `agent run <arquivo.json>`. Aceita
  dois formatos, decididos pela presença do array `steps`:
  - **Workflow** (`workflows/exemplos/`): lista de passos executados em
    sequência, cada um podendo usar `{{id}}` para reaproveitar a saída de
    um passo anterior, e opcionalmente `keepHistory` para encadear a
    conversa entre passos.
  - **Persona** (`agents/exemplos/`): configuração de um agente (modelo,
    instrução extra, ferramentas permitidas) que abre um chat interativo.
    `gemini-code aliados importar` transforma uma persona em agente pessoal.

## Agentes pessoais (v0.42.0)

- **`src/personalAgents.js`** — armazenamento em `~/.gemini-code/aliados/<nome>/` (`agente.json`,
  `conhecimento/`, `memoria.json`, `sessoes.json`), validação da definição, base de conhecimento
  (trechos de ~1200 caracteres indexados com BM25 e o tokenizador de `src/code-ia/tokenizer.js`,
  com cache por assinatura dos arquivos), memória e `prepararTurno`, que monta as opções de
  `runOnce` de cada mensagem (instrução com papel + memória + trechos relevantes, allowlist com as
  ferramentas do agente, modelo) e o contexto para `comAgente` (um `AsyncLocalStorage`).
- **`src/tools/personalTools.js`** — `memory_save`, `memory_forget` e `knowledge_search`. As
  declarações dependem do contexto: fora de uma conversa com agente pessoal a lista é vazia.
- **`src/personalAgentCommands.js`** — `gemini-code aliados ...` (`cli`) e `/aliados`, `/aliado`,
  `/memoria`, `@nome` no chat (`chat`, `mencao`), devolvendo linhas `{ nivel, texto }` como
  `src/workflowCommands.js`. O `chatLoop` do `bin/` recebe `{ agente }` para o `aliados chat`, que usa
  as sessões do próprio agente em vez das da pasta.
- A pasta `aliados/` está em `PROTECTED_DIRS` (`src/config.js`): `isProtected` em
  `src/tools/protectedPaths.js` recusa qualquer caminho real dentro dela e hard links para arquivos
  de lá.

## Testes

`tests/` usa o runner nativo do Node (`node --test`, sem dependência
extra). Cobertura atual:

| Arquivo testado | Teste |
|---|---|
| `src/agent.js` (`runOnce`, `podarHistorico`, `buildSystemInstruction`) | `agent.test.js` |
| `src/agents/runner.js` (`interpolate`) | `interpolate.test.js` |
| `src/agents/runner.js` (`runWorkflowData`) | `runner.test.js` |
| `src/ui/prompt.js` | `prompt.test.js` |
| `src/voice/voice.js` | `voice.test.js` |
| `src/live/live.js` (`pareceComandoDeSaida`, `dividirEmFrases`, `runLive`) | `live.test.js` |
| `src/cowork/server.js` (`localIps`, `getOrCreateToken`, `handleMessage`) | `cowork-server.test.js` |
| cowork com WebSocket real (servidor e cliente `ws`): cifra no fio, 4401, HTTP 429/503, mensagem grande, porta ocupada (v0.43.3; pula sem o pacote `ws`) | `coworkWebSocket.test.js` |
| canal cifrado do cowork, ataques simulados (homem no meio, PC falso, repetição, adulteração, token errado, inundação, prazo), `src/limitador.js` e limites da API de rotinas (v0.43.0) | `coworkCifrado.test.js` |
| `src/cowork/client.js` (`handleServerMessage`) | `cowork-client.test.js` |
| `src/routines.js` (armazenamento, cron, estados e recuperação) | `routines.test.js` |
| `src/routineRunner.js` (HTTP, retentativas, concorrência e destinos privados) | `routineRunner.test.js` |
| `src/routineApi.js` (autenticação e endpoints) | `routineApi.test.js` |
| `bin/gemini-code.js` (CLI completa, via processo filho) | `cli.test.js` |
| arquivos protegidos (`PROTECTED_PATHS`, symlink/hard link, hook plantado) | `protectedPaths.test.js` |
| permissões de `config.json` e do token do cowork | `secretFilePermissions.test.js` |
| `src/ui/prompt.js` sem terminal (stdin encerrado) | `promptHeadless.test.js` |
| `evals/run.js` (autoteste e controles negativos) | `evals.test.js` |
| ferramentas de arquivo/edição | `editFile.test.js`, `fileToolsAndSearch.test.js`, `touchesProtectedFile.test.js` |
| Markdown → HTML (slides) | `mdToHtml.test.js` |
| timeout de MCP | `mcpTimeout.test.js` |
| allowlist vazia = nenhuma ferramenta (v0.41.0) | `allowlistVazia.test.js` |
| `SECRET_PATHS`: o modelo não lê API key nem tokens | `leituraDeSegredos.test.js` |
| convidado só lê dentro do projeto | `convidadoNoProjeto.test.js` |
| `src/providers/openai.js` (servidor local imitando a API, streaming, loop do agente) | `openaiProvider.test.js` |
| navegador do agente: proxy bloqueando a rede local (IP, nome, IPv6), aprovação por site, regras, e com Chrome/Chromium real: página em JavaScript, clique, redirecionamento, formulário, lista, alerta, outro site barrado, print, perfil apagado (v0.44.0; a parte real pula sem navegador) | `navegador.test.js` |
| rotina de aparelho (TV) sem IA: só ações seguras, reconexão, passos sem perguntar, sem repetir, regras "negar", arquivo editado à mão recusado, CLI de ponta a ponta com o adb falso (v0.44.1) | `rotinaTv.test.js` |
| rotina de agente: validação, execução, sem repetir, perguntas viram "não" (run_shell de ponta a ponta não roda), routines.json protegido, notificação, CLI (v0.44.0) | `rotinaAgente.test.js` |
| resposta mais longa que o tempo limite de inatividade termina sem `onText`; Ollama calado ou que cai no meio (servidores HTTP reais, v0.43.4) | `llamacppV037.test.js`, `ollama.test.js`, `openaiProvider.test.js` |
| `src/compact.js` (`enxugarResultadosAntigos`, `/compact ia`) | `contextoLongo.test.js` |
| `src/permissions.js` (regras negar/permitir) | `permissoes.test.js` |
| chaves fora do env do MCP, do `actions.log` e da URL | `vazamentoSegredos.test.js` |
| `src/imagens.js` e `run --json` | `imagensEJson.test.js` |
| MCP remoto (`McpHttpConnection`) | `mcpHttp.test.js` |
| `src/trust.js` (confiança no projeto) | `confiancaProjeto.test.js` |
| sessão por projeto (`getActiveFor`) | `sessaoPorProjeto.test.js` |
| `run_shell` em segundo plano + `shell_status` | `segundoPlano.test.js` |
| sandbox do `run_shell`: filtro seccomp conferido num emulador de BPF, ambiente, pastas, montagem, onde achar o bwrap, decisão (auto/sempre/off, `fora_da_sandbox`, rotinas) com um bwrap falso, e com o bwrap real: gravar fora, segredos, rede, socket do sistema, `.git`, timeout e encerrar (v0.45.0; a parte real é obrigatória no CI) | `sandbox.test.js` |
| gravar fora do projeto pergunta; nada dentro do `.git` (v0.45.0) | `areaTrabalho.test.js` |
| autoGit não roda config plantada (fsmonitor, gpg, filtro) (v0.45.0) | `snapshots.test.js` |
| `search_files`: arquivo como path, `\r\n`, `file_glob` com glob, `.gitignore`, regex catastrófica interrompida no prazo, trecho centrado (v0.45.1) | `buscaV0451.test.js` |
| esquema JSON (zod/pydantic) → subconjunto do Gemini; nomes MCP dentro das regras e de volta ao servidor certo (v0.45.1) | `schemaGemini.test.js` |
| argumentos em texto JSON dos provedores: conserto e erro claro (v0.45.1) | `argumentos.test.js` |
| `read_skill` por pasta e por nome; SKILL.md ilegível (v0.45.1) | `skillsV0451.test.js` |
| saúde: leitura dos valores, faixas nos limites, triagem com e sem acento, diário 0600, página sem script, privacidade (read_file/search/imagem), ferramentas só no aliado, remédios com lembrete (v0.46.0) | `saude.test.js` |
| rotina lembrete (v0.46.0) | `lembrete.test.js` |
| imagem: argumentos do ImageMagick, melhorar de verdade, IA com foto de entrada, descrever, travas, ferramenta (v0.46.0) | `imagem.test.js` |
| câmera e vídeo: fotografar por sistema, vigia com ImageMagick de verdade, ffmpeg de verdade (melhorar, slideshow), ferramentas (v0.46.0) | `cameraVideo.test.js` |
| melhorador de TV com o adb falso: diagnóstico só lê, otimizar pergunta cada passo (v0.46.0) | `tvOtimizar.test.js` |
| criar site/app, servidor local (fuga de pasta, 400), compras e iFood, skill com descrição em bloco YAML (v0.46.0) | `criadorCompras.test.js` |
| redes sociais contra um servidor falso que imita cada API: formato dos pedidos, publicação em paralelo, foto, assinatura OAuth 1.0a do X (exemplo oficial), erros sem token, sem seguir redirecionamento, travas contra spam, menções marcadas, ferramenta que sempre pergunta, post agendado (v0.47.0) | `redes.test.js` |
| celular pela tela com o adb falso: ler (uiautomator), tocar pelo texto/posição, deslizar, segurar, regras (v0.47.0) | `adbTela.test.js` |
| computador: comandos de Linux X11/Wayland, macOS e Windows; execução com programas falsos; abrir sem rodar comando; ferramenta que pergunta (v0.47.0) | `computador.test.js` |
| desafios: progresso, sequência, calendário, lembrete que se encerra, postar o progresso, ferramenta (v0.47.0) | `desafios.test.js` |
| sandbox sem órfão no encerrar, marca única por execução, `--at` das rotinas sem adivinhar a data (v0.47.0) | `v047.test.js` |
| modo site: segurança do servidor (chave, Origin, Host/DNS rebinding, CORS, CSP, tamanhos), conversa em eventos, uma por vez, confirmações na página (expiram em "não"), aliado, e a página num Chromium de verdade (v0.48.0); "Parar" pela página, página fechada e o botão clicado no Chromium (v0.48.1) | `site.test.js` |
| chat do terminal num pseudo-terminal de verdade (`script`): Ctrl+C para a resposta e corta a conexão, numa confirmação vale "não", interrompe o comando rodando, duas vezes sai sem órfão; no `você>`, sai (v0.49.1) | `chatTerminal.test.js` |
| comandos em andamento: SIGINT como um terminal, SIGKILL em 2 s para quem ignora (com os filhos), nada órfão ao sair; `run_shell` (direto e na sandbox) e `run_checks` interrompidos (v0.49.1) | `emAndamento.test.js` |
| versão chat (v0.49.0): páginas e CSP, histórico para a página (`paraExibicao`, `/api/historico`), Markdown seguro (blocos, links só http/https, HTML vira texto, texto hostil/enorme não trava) e o chat de ponta a ponta num Chromium de verdade; contraste WCAG AA de todos os pares de cor, nos temas claro e escuro (v0.49.3) | `site.test.js` |
| foto e vídeo pelo modo site (v0.51.0): envio (chave antes de ler, origem/Host, só os tipos de mídia, primeiros bytes, tamanho declarado e no meio, nome saneado, nunca sobrescreve, `.gitignore`, pasta que é link recusada, um por vez, envio cortado sem sobra, sobra antiga limpa), `/api/midia` (só o registrado, some com link ou arquivo apagado), anexos na conversa (caminho e foto para o modelo, com limite), evento `midia` do que as ferramentas criam (segredo nunca), histórico com as mídias, `video` ligado só nesta execução, e a página num Chromium de verdade (mandar a foto pelo clipe, a prévia e a foto editada, recarregar; falha sem `blob:` na CSP) | `siteMidia.test.js` |
| perfis de cor ICC (v0.51.0): perfil sRGB v4 bem formado (cabeçalho, tags alinhadas, MD5), as contas batem com as matrizes de referência do sRGB e do Display P3, nome do perfil saneado | `perfilCor.test.js` |
| chave pela página (v0.52.0): falta da chave no histórico sem nunca mostrá-la, formato, recusada não salva, sem internet salva sem conferir, senha mestra, limite de tentativas, a conferência de verdade (cabeçalho, nunca na URL), o site direto na nuvem com chave, erro de chave reabre o cartão, as sugestões do aliado (limpas, no máximo 4); modo até terminar no site (eventos, selo, página fechada que não para, pergunta que espera, fora do modo continua parando, mensagem automática fora do histórico); e num Chromium de verdade | `siteChave.test.js` |
| um site só (v0.53.0; o erro do microfone na tela e no lugar certo, v0.53.1; o pedido de verdade do microfone, cada recusa com o seu caminho e ouvir pelo Termux pela rota `/api/ouvir` — o texto limpo, um por vez, cancelar e "Parar" encerram o comando, o prazo sem deixar processo órfão, o programa plantado que não roda —, v0.53.2): a troca de aliado (lista limpa, conversa nova, a mensagem vai para o novo, só um que existe, nunca no meio de uma resposta, aliado quebrado não troca, sem a chave nada), o comando `site` de verdade com os aliados do usuário, e num Chromium de verdade: o seletor no topo, ditar pelo microfone com a resposta falada, o "Ouvir" e o parar, e o vai e volta entre o chat e o modo voz com a mesma conversa | `siteUnico.test.js` |
| modo até terminar (v0.52.0): marcas tiradas do texto e do streaming (mesmo cortadas entre pedaços), continua sozinho, "preciso de você", tetos (resposta repetida, continuações, passos), o "Parar" vale, subagente não continua, e o chat do terminal de verdade num pseudo-terminal | `ateTerminar.test.js` |
| criar imagem (v0.52.0): o pedido de verdade (modelo de imagem, chave no cabeçalho, formato no `imageConfig`), formato desconhecido recusado antes de gastar cota, `limit: 0` com o comando certo, a ferramenta com "sempre" só nesta execução | `criarImagem.test.js` |
| treinador de futebol (v0.52.0): biblioteca coerente, treino que fecha o tempo em todas as combinações (sem repetir exercício), criança sem bloco analítico, organização do campo, semana (MD, 2 jogos, ordem do microciclo), carga conferida à mão (datas como a gente digita, nunca no futuro, o dia local), prancheta (posições, nomes escapados e cortados, PNG de verdade conferido pelos pixels, nunca sobrescreve), a ferramenta sob demanda, o aliado e o comando | `futebol.test.js` |
| `HOME` vazio (v0.49.3): a trava do `add-pasta-gravavel`, a pergunta antes de gravar `~/.bashrc` com o projeto na pasta do usuário e os checkpoints usam a pasta do usuário de verdade, não a pasta atual | `pastaDoUsuario.test.js` |
| edição profissional de código (v0.50.0): motor (espaço no fim da linha, CRLF, trecho mais parecido, diff), `write_file` que não sobrescreve o que não leu nem o que mudou, CRLF/BOM mantidos, sintaxe conferida (JS/ESM, JSON/JSONC, Python, shell) sem rodar o código e sem um `python3`/`bash` plantado | `edicaoProfissional.test.js` |
| edição profissional de vídeo (v0.50.0): tempos, corte, atempo, escape do filtergraph, receita, plano do ffmpeg, textos empilhados, legenda deslocada, info com rotação, argv seguro e, com o ffmpeg de verdade, editar (volume -14 LUFS medido), juntar, capa, áudio, ferramenta e terminal; v0.50.1: HDR (HLG/PQ) convertido para SDR, vídeo de celular em pé, caminhos com aspas/dois-pontos/colchetes; v0.51.0: HDR no "melhorar", volume em duas passadas (som de mar a -14 ± 1 LUFS, também no juntar), foto Display P3 convertida no vídeo de fotos | `videoEdicao.test.js` |
| edição profissional de foto (v0.50.0): escape do texto para o ImageMagick, receita, argumentos e, com o ImageMagick de verdade, formato, textos, marca d'água, lote, EXIF retirado e foto girada endireitada, ferramenta e terminal; v0.51.0: foto Display P3 sai em sRGB com as cores certas (também numa pasta temporária com caracteres especiais), sem o lcms o perfil fica, GIF animado vira uma foto só | `imagemEdicao.test.js` |
| "Parar": `runOnce` com signal (antes do modelo, durante a resposta, entre ferramentas; histórico consistente); provedores sem repetir, sem trocar de lado, sem reserva e sem ligar o llama.cpp depois do "Parar"; conexão cortada de verdade (v0.48.1) | `parar.test.js` |
| hooks `UserPromptSubmit`, `SessionStart`, `Stop` | `hooksEventos.test.js` |
| subagentes do usuário (`.md`) | `subagentesDoUsuario.test.js` |
| anti-SSRF com IPv6 (`privateAddress`) e DNS rebinding nas rotinas (`src/redeSegura.js`) | `ssrfIpv6.test.js` |
| `edit_files`, `glob_files`, `web_fetch` (inclusive DNS rebinding, `src/redeSegura.js`) | `multiEditTools.test.js`, `globTools.test.js`, `webTools.test.js` |
| integração das ferramentas novas (`/passo`, modos restritos, risco de workflow) | `ferramentasIntegradas.test.js` |
| agentes pessoais: definição, conhecimento, memória, prompt, ferramentas no loop, pasta protegida, comandos e CLI de ponta a ponta (v0.42.0) | `agentesPessoais.test.js` |
| ferramenta `adb` com um adb falso que junta os argumentos como o real e os roda num `sh` com comandos falsos do aparelho: injeção, confirmação, teclas, alvo, print, erros | `adbTools.test.js` |
| texto das confirmações (`run_shell`, `/passo`, MCP, adb) sem controles de terminal; texto guardado dos aliados (v0.43.2) | `textoSeguro.test.js` |

`runOnce` (agente), `runWorkflowData`/`runWorkflow`/`runAgentFile`
(runner) e `runLive` (live) aceitam um argumento opcional `deps` — ex.:
`runOnce(msg, { deps: { chatWithTools: minhaFuncaoFake, execute: ... } })`
— só para permitir testar cada loop sem chamar a API do Gemini, o disco
real, o Termux:API ou MCP de verdade. Em uso normal (CLI) ninguém passa
esse argumento e o comportamento é idêntico ao de antes.

`src/cowork/server.js` e `src/cowork/client.js` seguem um padrão parecido,
mas via extração em vez de `deps`: a lógica de decidir o que fazer com cada
mensagem (`handleMessage` no servidor, `handleServerMessage` no cliente)
foi separada da conexão WebSocket em si, recebendo um `send`/`actions` que
o teste substitui por coletores simples. Isso testa toda a lógica de
autenticação, validação e histórico sem precisar abrir uma porta de rede de
verdade.

`bin/gemini-code.js` é testado como processo filho de verdade
(`child_process.spawnSync`), com `HOME` isolado numa pasta temporária por
teste — é o jeito mais fiel de testar uma CLI, já que o arquivo roda
`main()` na própria carga do módulo. Os testes cobrem toda a árvore de
comandos e subcomandos (ajuda, versão, config, skills, os "usos" de
design/media/voice/agent/cowork sem argumento) e os caminhos de erro que
não dependem de rede (API key ausente, arquivo de agente inexistente,
Termux:API ausente).

## O que falta (próximos passos)

- O cowork por WebSocket real é testado automaticamente desde a v0.43.3
  (`tests/coworkWebSocket.test.js`) onde o pacote `ws` está instalado — no CI,
  sempre; sem ele os testes são pulados com o motivo.
- Comandos que geram conteúdo de verdade (`design`, `media`, `run` com uma
  instrução real) continuam sem teste automatizado, já que dependem da API
  do Gemini respondendo de verdade — ficam cobertos apenas na parte de
  validação de argumentos.
- Documentação de API para quem quiser integrar servidores MCP próprios.

## Rotinas persistentes e serviço HTTP (v0.3.13)

- **`src/routines.js`** — armazenamento JSON atômico de definições, estados,
  gatilhos, próximas execuções e histórico de execuções; valida os fusos e os
  campos cron; fornece criação, ativação, pausa, retomada, exclusão controlada,
  filtragem e recuperação de tarefas interrompidas.
- **`src/routineRunner.js`** — executor `http-check` com timeout, status esperado,
  retentativas limitadas e proteção contra destinos IP privados/reservados por
  padrão. O agendador consulta rotinas a cada 15 segundos, limita a concorrência
  e aplica a política `skip` ou `run_once` para não despejar tarefas atrasadas.
- **`src/routineApi.js`** — API HTTP com autenticação Bearer, comparação de token
  em tempo constante, limite de requisições, limite de corpo JSON e rotas de
  listagem, criação, execução, ativação, pausa e histórico. A API escuta em
  loopback por padrão.
- **`Dockerfile` / `docker-compose.yml`** — pacote executável para um host
  persistente. O volume `/data` contém a configuração de rotinas, execuções e
  token se ele for gerado automaticamente. Em cloud, configure segredo,
  armazenamento persistente, reinício automático e terminação HTTPS.
- **`docs/openapi-routines.yaml`** — contrato inicial da API.

A agenda em `src/agenda.js` continua sendo um calendário de compromissos e não
é o agendador. Rotinas só executam enquanto `routines service` estiver ativo;
para sobreviver ao desligamento do telefone, o serviço precisa estar implantado
em outro host/contêiner ativo. O executor atual é deliberadamente restrito a
verificações HTTP idempotentes: tarefas genéricas que alterem arquivos, rodem
shell, publiquem releases ou chamem o agente ainda exigem novos executores,
permissões por ação e testes adicionais.
