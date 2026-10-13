## v0.3.11 — subagentes

Pedido: "faz ele ter um subagente também".

- **Nova ferramenta `delegate_task`** (`src/subagent.js`). O agente principal
  delega uma tarefa a um subagente com **contexto próprio** (não vê a conversa,
  então ler 30 arquivos não enche o contexto principal) e recebe só um
  **relatório curto** (máx. 6000 caracteres). Três tipos:
  - `explorador` — só leitura (`read_file`, `list_dir`, `search_files`, `read_skill`), 25 passos;
  - `revisor` — só leitura, instruído a achar bugs reais/segurança com `arquivo:linha`, 25 passos;
  - `executor` — lê, edita, roda comandos e `run_checks`, 40 passos.
- **Segurança**: o subagente nunca recebe mais ferramentas do que o agente pai
  (persona com `allowedTools` e sessão de convidado continuam valendo); nunca
  cria outro subagente (lista de ferramentas sem `delegate_task` + guarda de
  profundidade com `AsyncLocalStorage`); as confirmações `(s/n)` do `run_shell`
  e do `run_checks` continuam valendo dentro dele. Convidado não tem
  `delegate_task`.
- **Paralelismo**: 2 ou 3 `explorador`/`revisor` pedidos na mesma resposta rodam
  ao mesmo tempo (`Promise.all`); se houver um `executor` (ou mais de 3), roda
  tudo em sequência, preservando a ordem das respostas.
- **`gemini-code sub "tarefa" [--tipo T]`**: roda um subagente direto pela CLI.
- `runOnce` ganhou `maxSteps` e `logPrefix` (o subagente tem teto de passos
  próprio e as linhas dele saem indentadas). O loop de ferramentas foi
  refatorado em `executarChamada`, sem mudar o comportamento anterior.
- O prompt do sistema orienta quando delegar (investigação grande, revisão,
  subtarefa independente) e quando não (tarefa pequena: delegar custa uma
  chamada extra). `knowledge/AGENTS.md` ganhou a mesma regra.
- 5 testes novos. Com `chalk` simulado: 221 de 223 passam (as 2 restantes só
  precisam do `ws` real). **Não testado contra o Gemini real** — rode no Termux
  `gemini-code sub "resuma a estrutura deste projeto"` e depois um `chat` pedindo
  uma revisão grande, para ver o modelo escolher delegar sozinho.

---

## v0.3.10 — a chave trancada não vaza mais; dados locais à prova de corrupção

Quinta rodada de "melhora ainda mais". Desta vez achei um bug de segurança.

- **Bug de segurança: a apiKey voltava para o disco em texto puro** (`src/config.js`).
  `saveConfig` mesclava em cima de `loadConfig()`, que já traz a chave
  *destrancada* da sessão. Então, depois de `unlock()`, qualquer `saveConfig`
  (reproduzido com `setGuestPassphrase`) gravava a chave aberta no `config.json`
  e o cadeado deixava de valer. Agora a mescla parte só do que está gravado.
  **Se você usa chave de segurança + convidado, confira:**
  `grep apiKey ~/.gemini-code/config.json` — se aparecer a chave inteira, rode
  `gemini-code config` com o subcomando de trancar de novo (e considere gerar uma
  chave nova no AI Studio).
- **`saveConfig` congelava ~20 padrões no arquivo** a cada `config set-*`,
  recriando o bug de "padrão antigo preso" que a `migrarConfig` cura. Agora só
  grava o que é seu.
- **Agenda e projetos perdiam tudo se o arquivo corrompesse** (`src/jsonStore.js`
  novo). Um JSON cortado (Termux fechado no meio da escrita) virava "vazio" e a
  próxima gravação apagava de vez. Agora a escrita é atômica (tmp + rename) e,
  se o arquivo estiver ilegível, ele é guardado como `*.corrompido-<data>` antes
  de começar vazio, com aviso na tela.
- **Agenda aceitava datas que não existem** (`2026-02-31` passava no formato e
  virava evento invisível); agora recusa.
- **Backups no mesmo milissegundo se sobrescreviam** (`src/tools/backup.js`) e
  a ordenação ficava errada (`-` vem antes de `.` no texto). Nome com sufixo +
  comparador cronológico.
- **Skills com `SKILL.md` em CRLF ou com BOM** tinham o front matter ignorado
  (nome/descrição sumiam do prompt); `read_skill` sem `path` ou com arquivo
  inexistente agora dá erro claro em vez de exceção.
- 4 testes novos. Com `chalk` simulado: 216 de 218 passam (as 2 restantes só
  precisam do `ws` real).

---

## v0.3.9 — run_checks com confirmação, conhecimento do Neto no pacote

Quarta rodada de "melhora ainda mais".

- **`run_checks` não fura mais o `confirmShell`** (`src/tools/checkTools.js`).
  Ele roda `npm test`/`make test`, ou seja, scripts do `package.json` que o
  modelo pode ter acabado de editar, e fazia isso sem confirmação nenhuma.
  Agora, com `confirmShell` ligado, pergunta **uma vez por sessão**, mostrando
  os comandos exatos. Responder `n` devolve "cancelado pelo usuário" ao modelo
  (com a ordem de não rodar os testes por outro caminho). Com
  `confirmShell:false` nada muda.
- **`GEMINI.md` e `AGENTS.md` do Neto** vêm em `knowledge/` (ambiente Termux,
  preferências, regras de trabalho do agente). O `install.sh` copia para
  `~/.gemini-code/knowledge/` sem sobrescrever se você já tiver editado.
  Ficam fora da raiz de propósito: na raiz seriam carregados duas vezes
  (global + projeto) quando você rodar o agente dentro desta pasta.
- 1 teste novo; os de `checkTools` partem já confirmados. Com `chalk` simulado:
  212 de 214 passam (as 2 restantes só precisam do `ws` real).

---

## v0.3.8 — o erro do teste não some mais, backups restauráveis

Terceira rodada de "melhora ainda mais". Revisão das ferramentas achou
problemas pequenos, mas que atrapalhavam o agente no uso real.

- **Saída longa de `run_shell`/`run_checks` perdia justamente o erro**
  (`src/agent.js`). O corte em 20000 caracteres guardava só o começo; falha de
  teste/build aparece no FIM. Agora essas duas ferramentas mantêm o início
  (5000) + o fim (15000) e avisam quantos caracteres do meio foram omitidos.
  As outras ferramentas seguem como antes.
- **`read_file` mandava usar `grep_files`, que não existe** — o nome certo é
  `search_files`. O modelo tentava chamar uma ferramenta inexistente.
- **`read_file`/`edit_file` sem `path`** lançavam um `TypeError` cru; agora
  devolvem um erro claro. `read_file` também recusa arquivos acima de 50 MB
  em vez de carregá-los inteiros na memória só para truncar depois.
- **`edit_file` em arquivo CRLF**: um `old_text` multilinha escrito com `\n`
  nunca casava e a mensagem dizia só "confira espaços". Agora explica que o
  arquivo usa CRLF.
- **`list_dir`**: pastas primeiro, em ordem, e teto de 500 itens (antes uma
  pasta com milhares de arquivos enchia o contexto).
- **`search_files`**: pastas/arquivos com ponto (`.github`, `.eslintrc.json`)
  eram sempre invisíveis. Novo `include_hidden` (opt-in); `.env*`, `.ssh`,
  `.gnupg` e `.aws` continuam nunca sendo lidos.
- **`run_checks`**: `Makefile` sem alvo `test` deixou de gerar um falso
  "falhou" (mesmo tipo de erro que a v0.3.7 corrigiu no npm/pytest); roda com
  `CI=true` para jest/vitest/react-scripts não ficarem presos em modo watch;
  estouro de buffer aparece como "saída grande demais", não como exit code.
- **`run_shell`**: estouro do limite de 10 MB agora é explicado (antes aparecia
  `exit code ERR_CHILD_PROCESS_STDIO_MAXBUFFER`).
- **Backups agora dá pra restaurar**: `gemini-code backups arquivo` lista e
  `gemini-code backups restore arquivo [N]` restaura (N=1 é o mais recente).
  O conteúdo atual também vira backup — restaurar é reversível.
- **`actions.log` rotaciona** acima de 5 MB (`actions.log.1`); antes só crescia.
- 12 testes novos (`tests/v038.test.js`). Com `chalk` simulado: 211 de 213
  passam; as 2 restantes só precisam do `ws` real (`npm install && npm test`).

### Para o seu olho
`run_checks` executa `npm test`/`make test` sem pedir confirmação, mesmo com
`confirmShell:true` — se o modelo editar o script de teste do `package.json`,
ele roda na sequência. Não mudei isso (é decisão de comportamento sua), mas
é o próximo ponto que eu fecharia: perguntar uma vez por sessão antes do
primeiro `run_checks` quando `confirmShell` estiver ligado.

---

## v0.3.7 — MCP funcionando de verdade, run_checks sem falso alarme

Segunda rodada de "melhora ainda mais". Foco: coisas que estavam quebradas
em silêncio.

- **Bug grave: resultados de ferramentas MCP chegavam ao modelo como
  `[object Object]`** (`src/tools/mcpClient.js`, `src/agent.js`). O
  `tools/call` do MCP devolve `{ content: [{type:'text', text}], isError }`,
  e o agente fazia `String(resultado)`. Na prática, nenhuma ferramenta de MCP
  entregava algo útil. Agora `formatarResultado` junta os blocos de texto,
  marca `isError`, resume imagens/recursos; e o agente serializa qualquer
  objeto como JSON em vez de `String()`.
- **MCP: faltava `notifications/initialized`** depois do `initialize`.
  Servidores que seguem a especificação à risca recusam `tools/list` sem
  ela. Agora é enviada. O `clientInfo` também usa a versão real do pacote
  (estava fixo em 0.1.0).
- **MCP: escrever num servidor que já morreu derrubava o gemini-code**
  (EPIPE sem handler em `stdin`). Agora rejeita só a chamada pendente.
- **MCP: nome de servidor com `__`** quebrava o roteamento
  (`split('__')`); agora casa pelo prefixo dos servidores conhecidos.
- **`run_checks` sem falso alarme**: ignora o `"test": "echo \"Error: no test
  specified\" && exit 1"` do `npm init`; pytest com exit 5 (nenhum teste) ou
  sem pytest instalado vira "ignorado" em vez de "falhou" — antes o agente
  perseguia um erro que não existia.
- **Backup de caminho muito longo** não falha mais em silêncio (nome acima de
  255 bytes); usa o fim do caminho + hash.
- **`search_files`**: opção `ignore_case` e validação de `pattern`.
- 6 testes novos (incluindo um servidor MCP falso real que só responde
  depois da notificação). Com `chalk` simulado: 199 de 201 passam; as 2
  restantes só precisam do `ws` real (`npm install && npm test` no Termux).

## v0.3.6 — poda de histórico segura, read_file em partes, shell mais protegido

Pedido do usuário: "melhora ainda mais". Revisão do código achou 4 pontos reais.

- **Bug: `podarHistorico` quebrava pares chamada/resposta de ferramenta**
  (`src/agent.js`). Em tarefas longas (dezenas de passos de ferramenta numa
  única `runOnce`) o corte `slice(0, 2)` + `slice(-30)` podia deixar um
  `functionCall` sem o `functionResponse` correspondente, ou começar o
  trecho recente num `functionResponse` órfão — a API do Gemini recusa isso
  (erro 400) e a tarefa morria no meio. Agora o corte recua até uma
  mensagem de texto do usuário (fronteira segura), e o início preservado
  nunca termina numa chamada pendente. Sem fronteira segura, manda o
  histórico inteiro em vez de quebrar a API.
- **`read_file` com `start_line` / `end_line`** (1-based, inclusivo, linhas
  numeradas). A mensagem de truncamento já dizia "leia em partes", mas não
  existia como — o modelo ficava preso em arquivos grandes.
- **Validação de argumentos**: `write_file` sem `content` gravava a string
  `"undefined"` no arquivo; `edit_file` com `old_text` vazio fazia o `split`
  contar um absurdo de ocorrências. Ambos agora devolvem erro claro e não
  tocam no arquivo.
- **Mais comandos pedem confirmação mesmo com `confirmShell:false`**
  (`isDestructiveCommand`): `rm -r` sem `-f` / `rm -r -f` / `--recursive`,
  `find -delete`, `shred`, `git branch -D`, `git checkout -- .`,
  `git restore .`, `git stash drop/clear` e `curl|wget ... | sh`. Testes
  cobrem os falsos positivos óbvios (`git restore --staged`, `curl | jq`,
  `git checkout main`, `ls -r`...).
- 11 testes novos. Com `chalk` simulado, 192 de 194 passam; as 2 que
  sobram (`cowork-client`/`cowork-server`) só precisam do módulo `ws` real —
  rode `npm install && npm test` no Termux para confirmar a suíte inteira.

## v0.3.5 — teste desatualizado corrigido (mascaramento da API key)

Rodando `npm test` de verdade no Termux (não só no ambiente de build), sobrou
1 falha: `tests/cli.test.js` — "config set-key grava a chave e config show
reflete a mudança" esperava que `config show` devolvesse a API key em texto
puro. Isso ficou desatualizado desde a v0.3.2, quando `config show` passou a
**sempre mascarar** a chave (só os últimos 4 caracteres visíveis — ver
`src/security.js:mascarar`), inclusive a que acabou de ser salva. O
comportamento do programa estava certo; só o teste não tinha acompanhado
essa mudança. Ajustado para esperar o valor mascarado.

- Suíte completa agora sem nenhuma falha conhecida.

## v0.3.4 — modo ciência, agenda e projetos

Pedido do usuário: um "modo ciência" que explica curiosidade científica de
forma fixa e profissional, um calendário simples ("dia 7 o que tá marcado?")
e uma área separada pra listar projetos — tudo sem gastar cota extra da API.

- **`gemini-code ciencia "pergunta"` / `/ciencia` no chat`** (`src/modoCiencia.js`):
  reaproveita o mesmo `runOnce` de sempre com uma instrução extra que fixa o
  formato da resposta em 3 seções (números/grandeza física, comparação
  prática do dia a dia, e se dá pra escapar/reverter/evitar). Não é um
  provedor novo nem uma chamada a mais — é a mesma chamada única que uma
  pergunta normal já faz, só com um `extraSystemInstruction` diferente. Fica
  de fora do histórico da conversa de propósito, pra não inflar o contexto
  (e o custo) das próximas mensagens do chat.
- **`gemini-code agenda ...` / `/agenda` no chat** (`src/agenda.js`): agenda
  local em `~/.gemini-code/agenda.json` — `agenda add "texto" --dia 7` marca
  algo (resolve automaticamente pro mês atual, ou o seguinte se aquele dia já
  passou), `agenda dia 7` mostra o que está marcado, `agenda listar` lista
  tudo ordenado por data. Puramente arquivo local, zero chamada de API.
- **`gemini-code projetos ...` / `/projetos` no chat** (`src/projetos.js`):
  registro simples de projetos (nome, pasta, nota), guardado em
  `~/.gemini-code/projetos.json`, fora do fluxo de chat — não precisa rolar
  o histórico da conversa pra lembrar o que tem em andamento.
- `agenda` e `projetos` entraram na lista de comandos que não pedem a chave
  de segurança (`COMANDOS_SEM_DESBLOQUEIO`) — são só arquivo local, sem
  `apiKey` nenhuma envolvida, então pedir a senha só pra ver a lista seria
  atrito à toa.
- **Fora do escopo desta versão, de propósito**: integração com Microsoft
  365 no navegador e uma UI com "abas" não têm como entrar num agente de
  **terminal** (Termux/CLI) sem mudar a natureza do projeto — isso pediria
  uma extensão de navegador ou um add-in do Office, algo mais parecido com o
  projeto separado de extensão Chrome do usuário do que com o gemini-code.
  "Projetos" acima foi a leitura mais próxima do pedido de "aba separada"
  dentro do que um CLI consegue oferecer.
- 15 testes novos (`tests/agenda.test.js`, `tests/projetos.test.js`). Suíte
  completa: 127 passam, mesmas 20 falhas pré-existentes de antes — nenhuma
  regressão.

## v0.3.3 — chave mestra + chave de convidado (acesso limitado pra amigos)

Pedido do usuário: dar acesso ao gemini-code pra amigos testarem, mas sem
entregar a mesma chave que dá acesso total.

- **Duas chaves, mesma apiKey**: `config set-guest-passphrase` cria uma
  segunda senha (exige a chave mestra pra confirmar) que também destranca a
  API key, mas marca a sessão como `guest`. A chave mestra continua sendo a
  única com acesso total.
- **Restrição automática de ferramentas (`src/security.js`,
  `restringirParaSessao`)**: aplicada num ponto único, dentro de `runOnce`
  (`src/agent.js`) — cobre chat, `run`, personas e workflows de uma vez, sem
  precisar mexer em cada comando. Sessão de convidado só enxerga
  `read_file`, `list_dir`, `search_files`, `read_skill`, `run_checks` — nada
  de `write_file`, `edit_file`, `run_shell` ou ferramentas de MCP. Se uma
  persona (`agents/*.json`) pedir mais que isso, a interseção com a lista de
  convidado vence — a persona não consegue "destravar" mais acesso.
  Convidado tentando escrever/apagar um arquivo ou rodar shell recebe erro
  claro, não falha silenciosa.
- **`design image` e `media video/music/sound` bloqueados pra convidado** —
  geração de mídia consome cota paga da API do dono; convidado com a chave
  de convidado não consegue gastar isso.
- **`config show`** também mascara a existência da chave de convidado, sem
  mostrar nada que ajude a adivinhar a senha.
- Chave de convidado pode ser removida (`config remove-guest-passphrase`,
  exige a mestra) sem afetar a mestra; remover a mestra
  (`config remove-passphrase`) remove as duas juntas.
- 2 testes novos em `security.test.js`. Suíte completa: 112 passam, mesmas
  20 falhas pré-existentes de antes — nenhuma regressão.

## v0.3.2 — chave de segurança pra proteger a API key em disco

Pedido do usuário: a `apiKey` do Gemini ficava em **texto puro** em
`~/.gemini-code/config.json` — quem tivesse acesso ao arquivo (celular
destravado, backup na nuvem, etc.) lia a chave direto.

- **`src/security.js` (novo)**: `gemini-code config set-passphrase` criptografa
  a apiKey já salva (AES-256-GCM, chave derivada da passphrase via `scrypt`
  com salt aleatório) e apaga a versão em texto puro. A passphrase nunca é
  gravada em disco nem logada — fica só em memória, na sessão atual, depois de
  um `unlock` correto.
- **`gemini-code config unlock`**: destrava a sessão atual digitando a chave de
  segurança. Se não for chamado antes, qualquer comando que precise da API key
  (chat, run, design, media, voice...) agora pede a chave sozinho, até 3
  tentativas, antes de seguir — não precisa lembrar de rodar `unlock` à parte.
- **`gemini-code config remove-passphrase`**: remove a proteção (exige a
  chave correta), volta pro comportamento de antes.
- **`config show` nunca mais imprime a apiKey em texto puro** — mesmo
  desbloqueada, mostra só os últimos 4 caracteres (ex.: `******7890`). Isso
  vale independente de ter passphrase configurada ou não, pra evitar vazar em
  print/screenshot/log do terminal.
- **`config set-key` recusa sobrescrever silenciosamente** uma chave já
  protegida — pede pra remover a proteção antes, pra não deixar o cadeado
  "furado" sem o usuário perceber.
- 7 testes novos em `security.test.js` (criptografia, mascaramento). Suíte
  completa: 110 passam, mesmas 20 falhas pré-existentes de antes (sem
  `node_modules` neste ambiente) — nenhuma regressão.

## v0.3.1 — roadmap "competir fora do nicho": auto-correção, backup e log

Não é correção de bug: são os 5 pontos que faltavam pra sair de "ótimo no meu
setup" pra "confiável fora dele também" — pedido explícito do usuário depois
de comparar o gemini-code com Claude Code/Codex/Antigravity.

- **Auto-correção (`src/tools/checkTools.js`, nova ferramenta `run_checks`)**:
  detecta `package.json` (scripts `test`/`lint`), `pytest.ini`/`pyproject.toml`/
  `requirements.txt` ou `Makefile` no diretório do projeto sendo editado e roda
  o comando correspondente. O system prompt (`src/agent.js`) agora instrui o
  modelo a chamar `run_checks` depois de editar código e corrigir antes de
  concluir a tarefa, em vez de parar no primeiro erro.
- **Backup automático (`src/tools/backup.js`)**: `write_file`/`edit_file` agora
  salvam o conteúdo anterior em `~/.gemini-code/backups/` (espelhando o
  caminho original, com timestamp) sempre que vão sobrescrever um arquivo que
  já existia — não afeta criação de arquivo novo. Mantém só os 20 backups mais
  recentes por arquivo.
- **Comandos destrutivos (`src/tools/shellTools.js`, `isDestructiveCommand`)**:
  `rm -rf`, `git push --force`, `git reset --hard`, `git clean -f`, `dd if=`,
  `mkfs` e afins agora forçam confirmação no terminal mesmo com
  `confirmShell:false` — mesma lógica já usada pros arquivos protegidos.
- **Contexto de projeto automático (`src/agent.js`)**: no início de cada
  sessão, o system prompt já inclui um resumo do projeto no diretório atual
  (nome e scripts do `package.json`, ou presença de projeto Python) — sem
  precisar o usuário explicar de novo toda vez.
- **Log de decisões (`src/decisionLog.js`)**: cada chamada de ferramenta grava
  uma linha em `~/.gemini-code/history/actions.log` (JSON Lines: timestamp,
  ferramenta, args resumidos, resultado ou erro resumido) — puramente
  aditivo, best-effort (nunca derruba o agente se falhar).
- 24 testes novos (`backup`, `destructiveCommand`, `checkTools`, `decisionLog`).
  Suíte completa continua em 20 falhas pré-existentes, todas por falta de
  `node_modules` (sem rede neste ambiente) — nenhuma regressão introduzida
  pelos itens acima.

# Correções aplicadas neste projeto (set/2026)

Revisão completa do `gemini-code`: testei os fluxos principais rodando de
verdade (com stubs no lugar da API do Gemini, já que aqui eu não tenho acesso
à internet nem à sua chave), então cada item abaixo foi confirmado na prática,
não só lendo o código.

## 1. Bug principal: `agent run` quebrava com qualquer persona de agente

O README e o `--help` sempre disseram que `agent run` roda tanto **workflows**
(`workflows/*.json`, vários passos em sequência) quanto **personas prontas**
(`agents/*.json`, uma configuração de agente pra conversar). Só que o código
só sabia rodar workflows — `runner.js` fazia `for (const step of
workflow.steps)` sem checar se `steps` existia. Qualquer persona (inclusive o
próprio exemplo `agents/exemplos/revisor-de-codigo.json` que vem no projeto)
quebrava na hora.

**Corrigido em `src/agents/runner.js` e `bin/gemini-code.js`:** agora o
comando lê o JSON e decide sozinho:
- tem array `"steps"` → roda como workflow, do jeito que já funcionava;
- não tem → abre um chat interativo usando o `model`, o
  `systemInstructionExtra` e o `allowedTools` daquele arquivo de persona
  (esses três campos existiam no JSON de exemplo mas eram ignorados por
  completo — precisei estender `agent.js` e `tools/index.js` pra eles
  passarem a valer, inclusive bloqueando de verdade ferramentas fora da
  lista permitida, não só "escondendo" elas do modelo).

Testado rodando `agent run` com um workflow (continua funcionando igual) e
com uma persona (agora abre o chat, usa o nome/descrição dela e bloqueia
ferramenta fora da lista).

## 2. MCP sem timeout podia travar o app inteiro pra sempre

`src/tools/mcpClient.js`: as chamadas para um servidor MCP nunca tinham
timeout nem tratavam a saída/erro do processo do servidor. Se um servidor MCP
travasse ou nunca respondesse, a promise ficava pendurada pra sempre e
**travava o `gemini-code` inteiro**, sem jeito de recuperar a não ser
Ctrl+C. Reproduzi isso de propósito (um servidor fake que nunca responde) e
confirmei o travamento antes de mexer.

**Corrigido:** timeout de 20s por chamada, tratamento de erro/saída do
processo do servidor, e erros JSON-RPC (campo `"error"`) agora viram erro de
verdade em vez de serem ignorados silenciosamente. Achei ainda um segundo
problema testando o conserto: mesmo com o timeout, o processo do servidor que
travou ficava **órfão rodando** (nada matava ele), e isso sozinho já
impedia o programa de encerrar no final — corrigido matando o processo
sempre que a inicialização falha por qualquer motivo.

## 3. Modelos do Gemini desligados/desatualizados

- `imageModel` (config.js) apontava pro `gemini-2.0-flash-exp-image-generation`
  — **esse modelo foi desligado** (toda a linha Gemini 2.0 Flash saiu do ar
  em jun/2026). Troquei pelo `gemini-2.5-flash-image` (atual, "Nano Banana").
- Vídeo (`mediaTools.js`) usava `veo-2.0-generate-001`, bem defasado — troquei
  pelo `veo-3.1-generate-preview`, o documentado atualmente.
- O exemplo `agents/exemplos/revisor-de-codigo.json` usava `gemini-2.5-pro`,
  que será desligado em 16/out/2026 — atualizei para `gemini-3.1-pro-preview`
  (o mesmo padrão que o resto do projeto já usa).

## 4. Correções menores

- `bin/gemini-code.js`: `agent run` sem caminho, e `cowork connect` sem IP,
  agora mostram a mensagem de uso em vez de um erro genérico feio.
- `voice listen` e `live` agora fecham as conexões MCP ao terminar (antes só
  `run` e `agent run` faziam isso; sem essa limpeza, o processo podia ficar
  pendurado no terminal quando havia servidor MCP configurado).
- `designTools.js`: se o Gemini escrever algum texto de preâmbulo antes do
  primeiro `##` slide, esse texto não vira mais um "slide" quebrado sem
  título.

## Segunda revisão (mesmo mês) — depois de "melhora ainda mais o código"

Reli o projeto inteiro de novo (já com os consertos acima aplicados) atrás
de mais problemas. Achei mais um bug real de trava/hang, uma falha de
segurança pequena, um bug visual no HTML gerado e uma inconsistência de
histórico. Todos testados na prática (sem precisar da API do Gemini, já que
são todos em código que não depende dela).

### 5. `run_shell` travava o processo inteiro, não só o comando

`src/tools/shellTools.js` usava `execSync`, que **bloqueia a thread
principal do Node por completo** enquanto o comando roda — sem exagero,
trava tudo: o timeout de 20s do cliente MCP não dispara (o `setTimeout` não
roda com o event loop travado), e no `cowork server` **nenhum outro cliente
WebSocket conseguia ser atendido** enquanto um comando de shell rodava,
mesmo que fosse de uma tarefa/celular diferente. E não havia limite de
tempo nenhum: se o modelo mandasse rodar algo como `npm run dev` ou
`tail -f` por engano, o processo ficava pendurado pra sempre.

**Corrigido:** troquei `execSync` por `exec` assíncrono, com um timeout
próprio configurável (`shellTimeoutMs` em config.js, padrão 2 minutos) que
mata o comando sozinho se ele não terminar a tempo. Testei rodando um
comando normal (funciona igual), um comando com `sleep 10` (é morto no
tempo certo com mensagem clara) e confirmei com um contador em paralelo que
o event loop continua livre durante a execução (antes ficava zerado, agora
conta normalmente).

### 6. Token do Cowork comparado de um jeito que vaza timing

`src/cowork/server.js` comparava o token recebido do celular com `===`.
Comparação direta de string vaza quanto tempo leva pra achar a primeira
letra errada, o que em teoria permite descobrir o token caractere por
caractere por quem estiver na mesma rede local. Troquei por comparação dos
hashes SHA-256 dos dois lados com `crypto.timingSafeEqual`, que sempre leva
o mesmo tempo não importa onde a diferença esteja.

### 7. HTML dos slides quebrava com `<`/`&` e listas ficavam sem `<ul>`

`src/tools/designTools.js` (`mdToHtml`) colocava o texto gerado pelo Gemini
direto no HTML sem escapar nada — um slide sobre programação mencionando
`<script>` ou `A && B`, por exemplo, quebrava a tag/estrutura da página a
partir dali. Além disso, cada bullet virava um `<li>` solto, sem nenhum
`<ul>` em volta — HTML inválido, com recuo/marcador do navegador todo
desalinhado. Corrigido: texto escapado (`&`, `<`, `>`) e bullets
consecutivos agrupados num `<ul>...</ul>`.

### 8. Histórico inconsistente quando o limite de 8 passos era atingido

`src/agent.js`: quando o modelo passava 8 rodadas seguidas só chamando
ferramentas sem nunca responder em texto, a mensagem de aviso
("número máximo de passos...") era devolvida pro usuário mas **não** entrava
no `history` retornado — na próxima pergunta, o modelo via um monte de
`functionResponse` sem nenhuma fala do "assistente" fechando aquele turno.
Corrigido: o aviso agora entra no histórico como uma fala normal do modelo.

### 9. `Ctrl+C` no modo `chat` não garantia limpeza do MCP

Só `run`, `voice listen`, `live` e `agent run` (workflow) chamavam
`stopMcp()` explicitamente — o comando mais usado no dia a dia, `chat`,
nunca chamava, contando só com o processo filho do MCP receber o SIGINT
junto com o pai por estar no mesmo grupo do terminal (o que costuma
funcionar, mas não é garantido em todo ambiente, ex.: `gemini-code` chamado
de dentro de outro script). Adicionei em `bin/gemini-code.js` um handler
único de `SIGINT`/`SIGTERM` que chama `stopMcp()` antes de sair, cobrindo
todos os comandos.

## Terceira revisão (v0.2.0) — os 14 itens da última rodada

Essa rodada veio de uma lista de 14 problemas encontrados numa revisão de
código completa. Apliquei todos, na ordem de prioridade sugerida. Resumo:

1. **`read_file`/`list_dir` sem limite nem tratamento de erro.** Agora
   `read_file` checa se o caminho existe, se não é um diretório, detecta
   binário (olhando os primeiros 8000 bytes por byte nulo) e trunca em 200 KB
   com aviso explícito em vez de silencioso. `list_dir` avisa se o caminho
   não existe/não é diretório e mostra "(vazio)" em vez de string vazia.
2. **`edit_file` novo.** Substitui um trecho exato por outro sem reescrever o
   arquivo inteiro — recusa se o trecho não existir ou existir mais de uma
   vez (pede mais contexto pra ficar único). Registrado em `fileTools.js`.
3. **`search_files` novo** (`src/tools/searchTools.js`). Grep recursivo em
   Node puro (sem depender de `grep` existir no PATH), ignora
   `node_modules`/`.git`/pastas de build, aceita busca literal ou regex e
   filtro por extensão, corta em 100 resultados.
4. **Streaming de texto.** `chatWithTools` (em `gemini.js`) ganhou um modo
   SSE (`:streamGenerateContent?alt=sse`) usado quando um callback `onText`
   é passado — o `chat` e as personas de agente agora imprimem a resposta
   conforme ela chega, em vez de ficar com o cursor parado 10-30s. Dá pra
   desligar voltando `enableStreaming: false` no config.
5. **Histórico sem limite.** `agent.js` agora poda o histórico acima de 40
   mensagens, mantendo as 2 primeiras + as 30 mais recentes.
6. **Truncamento de tool result sem avisar o modelo.** O corte de 20000
   caracteres agora vem com `[... resultado truncado: mostrando 20000 de N
   caracteres]` embutido no próprio texto devolvido pro modelo.
7. **`run_shell` sem `cwd` e escondendo `stderr`.** Aceita `cwd` opcional no
   schema (valida que existe antes de rodar) e agora devolve stdout **e**
   stderr concatenados (identificados com `[stderr]`) mais o exit code, em
   vez de `stdout || stderr`.
8. **Duas readlines concorrentes no mesmo stdin.** Criei
   `src/ui/prompt.js` com uma única interface de readline compartilhada;
   `chatLoop`, `runPersonaChat` e a confirmação de `run_shell` usam todas a
   mesma agora, em vez de cada uma abrir a sua.
9. **`cowork/client.js` sem try/catch no `JSON.parse`.** Corrigido — mensagem
   malformada do servidor agora só é logada e ignorada, não derruba o
   cliente. `cowork/server.js` passou a validar que `msg.prompt` é uma
   string não-vazia antes de repassar pro agente.
10. **`live.js`/`voice.js` com `execSync`/`execFileSync` (bloqueante).**
    `voice.js` migrado pra `execFile` assíncrono (via `util.promisify`); todos
    os pontos que chamavam `voice.speak`/`voice.listen`/`isTermuxApiAvailable`
    (em `live.js` e no comando `voice` da CLI) passaram a usar `await`.
11. **Workflow ignorava histórico entre passos.** `runWorkflowData` aceita
    agora `"keepHistory": true` (no passo ou no workflow inteiro) pra passar
    o histórico de conversa adiante entre passos, em vez de sempre começar
    do zero.
12. **Sem comandos de sessão no chat.** Adicionados `/help`, `/clear`,
    `/model NOME` e `/save [nome]` (grava em `HISTORY_DIR`, que existia em
    `config.js` desde sempre mas nunca era usado por ninguém). Também
    adicionei `--version`/`-v` na CLI.
13. **Zero testes.** Criada a pasta `tests/` com `node --test` (script
    `npm test` no `package.json`): 32 testes cobrindo `interpolate`,
    `touchesProtectedFile`, `edit_file` (sucesso, trecho ausente, trecho
    duplicado, arquivo inexistente, arquivo protegido), `read_file`/
    `list_dir` (erros e binário), `search_files` (busca, filtro de extensão,
    ignorar `node_modules`) e o timeout do cliente MCP — todos rodando sem
    precisar de API key nem rede (o MCP é testado contra um processo `node`
    real que só fica quieto de propósito). Rodei tudo localmente antes de
    fechar esta versão: 32/32 passando.
14. **Migração para `fetch` puro, removendo `@google/generative-ai`.**
    `generateText` e `generateImage` (usados por `gemini-code design`) foram
    reescritos pra falar direto com a API REST via `fetch`, do mesmo jeito
    que `chatWithTools` já fazia. A dependência arquivada saiu do
    `package.json` e do `package-lock.json` — o projeto agora só depende de
    `ws` e `chalk`.

## Nota: "sumiço" da pasta `teste-design/` não é regressão

Numa revisão externa, apontaram o desaparecimento de `teste-design/` entre
versões como sinal de bug/regressão. Não é: essa pasta nunca é criada nem
referenciada em nenhum lugar do código-fonte (busquei `teste-design` no
projeto inteiro — só aparece em `.gitignore` e `.eslintrc.json`, como
padrão de exclusão). É só o nome usado manualmente ao rodar
`gemini-code design` de dentro da própria pasta do projeto para testar; o
`.gitignore` deliberadamente deixa esse tipo de saída solta de fora (mesma
lógica do `teste.txt`, no comentário logo acima da linha). Deixei o
comentário do `.gitignore` mais explícito sobre isso para evitar a mesma
confusão de novo.

## Quarta revisão — achado testando de verdade num Termux, com API real

### 10. `model` padrão era um modelo sem tier gratuito (429 na primeira mensagem)

Testando `gemini-code chat` pela primeira vez com uma chave de API real (sem
billing habilitado, o caso comum de quem só quer testar), a primeira mensagem
já voltava `429 Bad Request` com `limit: 0` para `gemini-3.1-pro`. Não é um
limite baixo — a própria Google confirma que `gemini-3.1-pro-preview` não
tem tier gratuito nenhum, só pago. Como esse era o `model` padrão em
`config.js` (e também o modelo hardcoded no exemplo de persona
`agents/exemplos/revisor-de-codigo.json`), qualquer usuário novo sem cartão
associado à conta do Google AI Studio quebrava no primeiro uso de `chat` ou
`agent run` com essa persona — antes mesmo de escrever a primeira mensagem
de verdade.

**Corrigido:** padrão trocado para `gemini-2.5-pro`, que tem tier gratuito
de verdade (rate-limited, mas funciona) e continua sendo um modelo de
raciocínio "pro", não um downgrade disfarçado pra flash. Quem tiver billing
habilitado pode trocar de volta pro 3.1 com `gemini-code config set-model
gemini-3.1-pro-preview`. `fastModel` (`gemini-3.6-flash`, usado por
`design`) não precisou mudar — Flash tem tier gratuito normalmente.

### 11. "Sem crédito" com crédito: config antigo congelava o modelo velho + erro enganoso (v0.2.4)

Sintoma: `429` dizendo que a cota/plano acabou, mesmo com crédito na conta.

**Causa 1 (bug de código, confirmado):** na primeira execução, `loadConfig()`
gravava o `DEFAULT_CONFIG` inteiro em `~/.gemini-code/config.json`, e depois
lia com `{ ...DEFAULT_CONFIG, ...onDisk }` — o disco sempre vence. Resultado: a
correção do item 10 (trocar o modelo padrão) **nunca chegou a quem já tinha
rodado uma versão antiga**; o `model` velho (`gemini-3.1-pro-preview`, sem tier
gratuito) ficava congelado pra sempre.
**Corrigido:** (a) instalação nova só grava o que é do usuário
(`configVersion` + chave do env, se houver); (b) `migrarConfig()` roda uma vez
e remove do arquivo o `model` se for um padrão antigo (`gemini-3.1-pro-preview`
ou `gemini-2.5-pro`), avisando no terminal. Modelo escolhido a dedo é mantido.

**Causa 2 (mensagem):** todo erro da API saía como `[NNN Bad Request]` e o 429
mostrava a frase crua do Google, que soa como "saldo zerado". Agora
`erroDaApi()` (em `gemini.js`, usada nas 4 chamadas) explica que 429 é cota
**por projeto e por modelo**, detecta `limit: 0`, e dá o passo seguinte;
403/404 também têm dica própria. A mensagem original do Google vai no fim.

**Padrão final: `gemini-3.6-flash`** (e o exemplo `revisor-de-codigo.json`).
Teste real num Termux (v0.2.4) mostrou que `gemini-2.5-flash` devolve 404 "no
longer available to new users" — o próprio Google manda migrar pro 3.6 Flash.
Fontes públicas também indicam que o 2.5 Pro virou só-pago em abr/2026 (não
confirmado na doc do Google). `configVersion` 3 migra quem ficou preso em
qualquer um desses padrões antigos. Pra usar outro:
`gemini-code config set-model NOME`.

Testes novos: `tests/config.test.js`, `tests/geminiErrors.test.js`.

### 12. Chat respondia em branco (streaming SSE com CRLF) — v0.2.6

Sintoma (Termux, API real, `gemini-3.6-flash`): `você> oi` e o
`gemini-code>` ficava vazio, sem texto e sem erro.

**Causa:** o Google separa os eventos do SSE com `\r\n\r\n`; o parser só
procurava `\n\n`, então nunca achava o fim de nenhum evento e descartava tudo.
Também não lia o que sobrava no buffer no fim do stream, e resposta sem
conteúdo virava silêncio em vez de erro.
**Corrigido em `chatWithToolsStream`:** normaliza CRLF→LF no buffer inteiro a
cada leitura (funciona mesmo se `\r` e `\n` chegarem em pedaços diferentes),
processa o resto do buffer no fim, junta linhas `data:` múltiplas, trata
evento `error` dentro do stream. Resposta sem nenhum conteúdo (stream ou não)
agora lança erro com `blockReason`/`finishReason` em vez de ficar muda.
Confirmado: o teste novo (`tests/geminiStream.test.js`) falha 5/6 no código da
v0.2.5 e passa na v0.2.6 — o caso LF puro passava nos dois, batendo com o sintoma.

Também: `fastModel` gravado em disco com `gemini-2.5-flash` (404 no `design`)
agora migra pra `gemini-3.6-flash` (`configVersion` 4).

### 13. 503 "high demand" e colagem de prompt com várias linhas — v0.2.7

Achados no primeiro uso real (Termux, `gemini-3.6-flash`), depois que o chat
voltou a responder:

**a) `HTTP 503 UNAVAILABLE ... high demand`.** Erro temporário do servidor do
Google, sem relação com conta/crédito. Antes: o chat só mostrava o erro e
morria o turno. **Agora:** `fetchComRetry()` tenta de novo sozinho (500/502/
503/504: 3 esperas de 2s/5s/10s, avisando na tela; erro de rede: 1 nova
tentativa). 429/403/404 NÃO são repetidos (não são transitórios). Se esgotar,
`erroDaApi` explica que é temporário e que não é problema da conta.

**b) Colar prompt de várias linhas só entregava a primeira.** `rl.question`
pegava a primeira linha; as demais viravam eventos `line` sem ouvinte e eram
descartadas — o modelo recebia só a 1ª frase e respondia fora do assunto
(tentou `list_dir` em vez de fazer o que o prompt pedia). **Agora:**
`perguntarColando()` (`src/ui/prompt.js`), usada no chat e no chat de
persona, junta as linhas que chegam numa janela de 150ms numa mensagem só.

Testes novos: `tests/geminiRetry.test.js`, `tests/perguntarColando.test.js`.

### 14. Última linha colada sujava o (s/n); 503 persistente; adivinhar modelo — v0.2.8

Achados no teste real da v0.2.7 (Termux, prompt colado do jogo de blocos):

**a) Última linha colada vazava pro `(s/n)`.** A colagem chegava inteira,
mas a ÚLTIMA linha vem sem `\n` e ficava no buffer de edição da readline
(`rl.line`). Ela reaparecia a cada redesenho e, quando o `run_shell` perguntou
`(s/n)`, o `s` digitado grudava nela ("sComece pelo terreno...") e a
confirmação não batia. **Corrigido** em `perguntarColando`: o resto do buffer
entra na mensagem e a linha é limpa. O teste novo (readline em modo TTY
simulado) falha na v0.2.7 e passa agora.

**b) 503 seguido de 503.** Mesmo com 3 retries o `gemini-3.6-flash` seguiu
"high demand" (Google, capacidade). Agora: 4 esperas (2/5/10/20s) e um
**modelo reserva opcional** — `gemini-code config set-fallback-model NOME` —
usado uma vez se o principal continuar indisponível e nada tiver sido impresso
ainda. Desligado por padrão (não chuto nome de modelo).

**c) Chega de adivinhar nomes de modelo.** Errei o padrão duas vezes (3.1-pro
sem tier grátis; 2.5-flash 404 pra conta nova). Novo comando
`gemini-code models` pergunta pra API quais modelos a SUA chave pode usar
(`generateContent`), e o `set-model`/`set-fallback-model` usam esses nomes.

Testes novos: `tests/geminiFallback.test.js` (+1 em `perguntarColando`).

## O que ainda vale seu olho

Um ponto específico de atenção: modelos Gemini 3 (o padrão deste projeto)
usam "thought signatures" em conversas com várias chamadas de ferramenta em
sequência — se um dia você notar o agente perdendo o fio da meada
especificamente em tarefas longas com muitas ferramentas encadeadas, esse é
o primeiro lugar que eu investigaria. O código já preserva `rawParts()`
(inclusive esse campo) entre turnos, então não deveria ser problema, mas é
uma área que eu não consigo testar contra a API de verdade daqui.

Como não tenho rede neste ambiente (o streaming da v0.2.6 foi validado com um fetch simulado que imita o formato CRLF real), não rodei `npm install` de verdade nem
testei contra a API/Gemini real — só a suíte de testes automatizados (que
não dependem disso) e checagem de sintaxe (`node --check`) em todos os
arquivos `.js` do projeto. Vale rodar `gemini-code chat` numa tarefa
qualquer antes de confiar 100% nas mudanças de streaming e de `run_shell`.


---

## v0.3.0 — modelo local, modo híbrido e conhecimento fixo

Não é correção de bug: é a versão que implementa o que faz esse agente ganhar de
um agente genérico no **seu** cenário (offline, seus projetos, sua linguagem).

- **Ollama (`src/providers/ollama.js`)**: modelo local via `/api/chat` com
  streaming, ferramentas, poda de histórico por orçamento de contexto e
  reconhecimento de chamada de ferramenta escrita como texto (modelos pequenos).
- **Roteador (`src/provider.js`)**: `provider` = `gemini` | `ollama` | `hybrid`.
  No híbrido, simples → local, pesado → nuvem, e cai pro outro lado se um falhar
  (sem internet, 503, cota, Ollama desligado). Chat ganhou `/local`, `/cloud`, `/auto`.
- **Conhecimento fixo (`src/knowledge.js`)**: `.md` em `~/.gemini-code/knowledge/`
  ou `GEMINI.md`/`AGENTS.md` no projeto entram direto no prompt (spec da NetoLang etc.).
  Modelo em `knowledge-exemplo/netolang.md`.
- Novos comandos: `ollama models|status`, `knowledge add|list`,
  `config set-provider|set-ollama-model|set-ollama-url`.
- Extras: primeira execução não mostra mais o aviso falso de "config corrompido";
  chat com stdin fechado encerra limpo em vez de `ERR_USE_AFTER_CLOSE`.
- 26 testes novos (`ollama`, `provider`, `knowledge`). Validado também de ponta a
  ponta contra um servidor HTTP falso do Ollama (tool call + spec no prompt + streaming).
  Não testado com um Ollama/modelo real nem com a API do Gemini (sem rede aqui).
