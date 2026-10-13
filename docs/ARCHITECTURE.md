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
  roda o agente com autenticação por token.

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
| `src/cowork/server.js` (`tokensBatem`, `localIps`, `getOrCreateToken`, `handleMessage`) | `cowork-server.test.js` |
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

- Testes de ponta a ponta para `cowork server`/`cowork connect` com um
  WebSocket real (hoje só a lógica de mensagens é testada, não o transporte
  em si — precisa do pacote `ws` instalado via `npm install`, que não roda
  sem rede no ambiente onde esta suíte foi validada).
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
