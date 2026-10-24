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
