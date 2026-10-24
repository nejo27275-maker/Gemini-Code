## 0.43.1 — controlar a TV e outros aparelhos por ADB

**Novo: ferramenta `adb`** (`src/tools/adbTools.js`) e comando `gemini-code adb`. O agente passa a controlar aparelhos Android **do próprio usuário** (Android TV, celular, tablet) por USB ou pela rede local, com o `adb` do Android SDK: listar/abrir/instalar/desinstalar/limpar apps, navegar numa TV pelas teclas do controle (`cima`, `baixo`, `ok`, `voltar`, `home`, `play`, `volume+`…), digitar texto, ler e gravar `settings`, tirar print (`screencap`), ver `logcat`, reiniciar e um `shell` livre no aparelho. No chat dá para pedir em português ("abre o YouTube na TV", "desce e entra", "tira um print"); também há o comando direto `gemini-code adb ...`. Guia completo em `docs/TV_ADB.md`.

**Segurança (igual ao `run_shell`):**

- Comandos montados como **lista de argumentos** e executados com `execFile` — **sem shell**: aspas, `;`, `$()` e afins não são interpretados, então não há injeção. O alvo (serial/ip) é validado e não pode começar com `-` (não vira uma flag do adb).
- Toda ação que **muda** o aparelho pede confirmação no terminal; as de **leitura** (`dispositivos`, `info`, `apps`, `estado`, `tela`, `logcat`) não pedem. Ações **irreversíveis** (reiniciar, desinstalar, limpar dados, `shell` destrutivo pela heurística do `run_shell`) confirmam **mesmo** com `adbConfirm:false`.
- As regras do config valem: `negar` bloqueia em qualquer modo (vem do loop do agente) e a nova função `permissions.permitido` deixa `permitir: ["adb"]` (ou com padrão) dispensar a confirmação de ações específicas. Config: `adbPath`, `adbSerial`, `adbPorta`, `adbConfirm`, com `gemini-code config set-adb-path|set-adb-serial`.
- O adb só conecta em aparelho onde o dono ligou a depuração e confiou nesta máquina (o aparelho pede confirmação). Não é ferramenta de invasão.

**Rodar na própria TV:** Android TV é Android; o gemini-code roda nela via Termux (sideload), como em qualquer Android (`ANDROID_TERMUX.md`). Na prática, controlar a TV de fora por adb é mais confortável do que digitar nela.

Testes: 20 novos em `tests/adbTools.test.js`, com um `adb` falso que registra os argumentos exatos de cada chamada — conferindo a montagem dos comandos, a confirmação (e o que a dispensa/força), o mapa de teclas, o alvo `-s`, o print salvo e as mensagens de erro (adb ausente, aparelho offline). ESLint 10 limpo. Não testado contra uma TV real (sem adb nem aparelho neste ambiente).

**Limites honestos:** controlar por adb não "deixa a TV mais rápida" por mágica — dá para fechar/limpar/desinstalar apps e ajustar configurações, com a sua confirmação, e nada além do que o adb já permite. Marcas diferentes usam nomes de app e caminhos de configuração diferentes; o agente descobre com `apps`/`estado`, mas pode errar o pacote.

## 0.43.0 — blindagem: cowork cifrado de ponta a ponta e limites contra sobrecarga

**Falha corrigida — P1: o token do cowork e todas as tarefas iam abertos pela rede.** O celular mandava `{type:"auth", token}` em texto puro por `ws://`, e as tarefas e respostas também. Qualquer um na mesma Wi-Fi com um capturador de tráfego pegava o token e rodava o agente inteiro no PC (arquivos e shell); com ARP spoofing, podia até alterar as tarefas no caminho. Confirmado no código anterior (`ws.send(JSON.stringify({ type: 'auth', token }))` no `client.js`); o teste novo procura o token e o texto da tarefa em cada quadro da rede.

**Protocolo 2** (`src/cowork/canalSeguro.js`, só `crypto` do Node, sem dependência nova): o servidor manda um nonce e uma chave X25519 efêmera; o cliente responde com os dele e uma prova HMAC-SHA256 do token sobre toda a transcrição; o servidor confere e devolve a própria prova, que o celular confere antes de mandar qualquer tarefa. As chaves de sessão saem por HKDF do segredo X25519, salgadas com o token, uma por direção; cada mensagem vai em AES-256-GCM com nonce = direção + contador, e o contador tem de ser exatamente o próximo. Resultado: o token não passa pela rede; um PC falso não recebe tarefas; quem está no meio não lê nem altera nada; mensagem repetida, pulada, adulterada ou refletida derruba a conexão; autenticação gravada não serve em outra conexão; e o tráfego gravado continua ilegível mesmo se o token vazar depois (sigilo futuro). Tamanho e horário das mensagens continuam visíveis.

**Contra sobrecarga (DoS):**

- cowork: no máximo 8 conexões; 10 s para autenticar; a autenticação tem de ser a primeira mensagem (qualquer desvio fecha); IP com 5 falhas (token errado ou lixo) em 15 min é recusado com HTTP 429 antes do aperto de mão; 60 mensagens por minuto por conexão; uma tarefa por vez (antes várias rodavam juntas na mesma conversa); compressão desligada (sem "bomba" de descompressão); cliente com teto de 16 MiB por mensagem (o padrão do `ws` era 100 MiB).
- API de rotinas: cabeçalhos em até 10 s e requisição inteira em até 30 s (contra "slowloris"), no máximo 128 conexões e 64 cabeçalhos, controle por IP com memória limitada (antes um `Map` que só crescia) e IP bloqueado por 15 min depois de 10 tokens errados.
- `src/limitador.js`: janela por chave com teto de memória, usado pelos dois.

**Novo:** `gemini-code cowork novo-token`. As versões anteriores já mandaram o token aberto: depois de atualizar o PC e o celular, troque-o. Um celular antigo é recusado com o aviso para atualizar.

**Quebra de compatibilidade (intencional):** cowork 0.43 não conversa com 0.42 ou anterior, nos dois sentidos.

Também: o recurso de agentes pessoais da v0.42.0 passou a se chamar **Aliados** (`gemini-code aliados`, `/aliado NOME`, `/aliados`, pasta `~/.gemini-code/aliados/`, pacote `.aliado.json`, config `aliadosConhecimentoMaxChars`); a v0.42.0 não chegou a ser publicada, então não há migração. E o ESLint completo (v10, regras recomendadas) passou a rodar limpo em todos os arquivos tocados — inclusive dois apontamentos que já existiam (`no-case-declarations` no `write_file`, import sem uso no `multiEditTools`); um aviso antigo de variável sem uso em `tests/agent.test.js` ficou como estava.

Testes: 740 (739 passando, 1 pulado como root), no Node 22. 18 novos em `tests/coworkCifrado.test.js`, com ataques simulados por uma "rede" em memória que registra cada quadro: homem no meio trocando a chave do hello, PC falso, autenticação gravada e reenviada, mensagem repetida/pulada/adulterada/refletida/de outra sessão, cliente antigo, chave pública inválida, token errado até o IP ser barrado, lixo antes do aperto de mão, conexão parada, texto aberto injetado depois da autenticação, inundação de mensagens e tarefa concorrente. O transporte de verdade (servidor `ws` numa porta local e cliente `ws`) foi conferido à mão com o `ws` embutido no Playwright, que existe neste ambiente: tarefa e token ausentes do tráfego, 4401 para token errado, HTTP 429 na 6ª tentativa (mesmo com o token certo, enquanto o IP está barrado), aviso para o cliente antigo e 4408 depois de 10 s sem autenticar.

**Limites:** nenhum programa é impossível de invadir. O protocolo usa primitivas padrão (as do TLS 1.3), mas é próprio e não teve auditoria externa. DDoS de verdade (muitas máquinas) se barra na rede, não no aplicativo: o cowork é para rede local e a API de rotinas escuta em `127.0.0.1` por padrão. Ofuscar o código contra engenharia reversa não foi feito porque não protegeria nada: o código é aberto e nenhum segredo mora nele. O bloqueio por IP também barra quem está atrás do mesmo IP que o atacante enquanto durar (15 min).

## 0.42.0 — Aliados: agentes pessoais com memória e base de conhecimento

Base: a v0.41.0, que estava no branch `claude/rlr-omni-evolution-fqrsux` e ainda não tinha entrado no `main`, foi incorporada sem alterações.

**Novo: `gemini-code aliados`** (`src/personalAgents.js`, `src/personalAgentCommands.js`, `src/tools/personalTools.js`). Cada agente pessoal tem:

- **instruções** próprias (até 8000 caracteres), **descrição** e até 6 **iniciadores** (sugestões de primeira mensagem; ao abrir a conversa, digitar o número manda a sugestão — só numa conversa vazia, para "2" no meio da conversa continuar sendo resposta);
- **base de conhecimento**: arquivos de texto (até 100 e 5 MB por agente). A cada mensagem, os trechos mais relevantes entram no prompt sozinhos (BM25 sobre trechos de ~1200 caracteres, com o tokenizador PT/EN do code-ia; base pequena vai inteira; orçamento `aliadosConhecimentoMaxChars`, padrão 8000) — sem depender do modelo lembrar de buscar, o que modelos locais pequenos fazem mal; `knowledge_search` existe para ir além. Binário (PDF, imagem, docx), arquivo acima de 1 MB, ocultos de uma pasta, segredos do gemini-code e texto com cara de chave/token são recusados (`--forcar` aceita só o último caso);
- **memória** persistente: `memory_save` / `memory_forget`. Padrão `confirmar` (cada mudança pergunta s/n; sem terminal, é "não"), `auto` (grava e avisa) ou `off`. Recusa o que parece segredo; até 200 itens; no prompt vai marcada como dado, não ordem;
- **ferramentas**: presets `conversa`, `leitura`, `pesquisa` (padrão: leitura + `web_fetch`, que pergunta antes) e `completo`, ou uma lista; nome desconhecido é erro ao criar (ferramenta que deixou de existir numa versão nova só sai da lista ao carregar);
- **modelo** próprio (`@local`, `openai:X`, Gemini...), que vale sobre o `/model`;
- **conversas** próprias, em qualquer pasta (`aliados chat NOME`, com `/session`). A definição é relida a cada mensagem: um `aliados editar` com o chat aberto vale na hora.

Comandos: `listar`, `criar` (por opções, por perguntas num terminal, ou `--ia "descrição"`: o modelo escreve descrição, instruções, iniciadores e o menor preset de ferramentas; você vê a prévia e confirma), `ver`, `editar`, `remover --sim`, `chat`, `run`, `conhecimento add|listar|remover`, `memoria listar|esquecer|limpar --sim`, `exportar` (pacote JSON com conhecimento; memória só com `--com-memoria`) e `importar` (mostra instruções e ferramentas pedidas e só grava depois do `s` ou `--sim`; aceita as personas antigas de `agents/*.json`). Exemplo novo: `agents/exemplos/assistente-pessoal.aliado.json`.

No chat comum: `/aliados`, `/aliado NOME` (a conversa passa a ser com ele; `/aliado off` volta), `@NOME mensagem` (só uma mensagem) e `/memoria`. No `/plano`, as ferramentas são a interseção das duas listas (o agente pessoal também só lê).

**Segurança:**

- `~/.gemini-code/aliados/` entrou em `PROTECTED_DIRS` (nova lista em `src/config.js`, usada por `isProtected`): `write_file`, `edit_file` e `edit_files` recusam qualquer caminho dentro dela, inclusive por symlink e hard link, e `run_shell` mencionando a pasta pede confirmação mesmo com `confirmShell: false`. Sem isso, uma página lida com `web_fetch` ou um repositório malicioso poderia reescrever as instruções de um agente, dar `completo` a ele ou plantar "memórias" que entram em toda conversa futura.
- Pasta 0700; memória, conversas, definição e conhecimento 0600 (`escreverJson` e o armazenamento de sessões ganharam `mode`).
- As ferramentas de memória só existem numa conversa com um agente pessoal (contexto por `AsyncLocalStorage`) e nunca na sessão de convidado.

**Corrigido no caminho (afeta todos os modos):** a instrução extra (persona, perfil `run --profile`, modo plano, modo ciência, agente pessoal) ia no FIM do prompt do sistema, e o provedor local corta o prompt pelo fim para caber em contextos pequenos — era o papel do agente que sumia primeiro, não o conhecimento fixo. Agora o extra vem antes do conhecimento fixo; o teste que exigia "termina com o extra" passou a exigir essa ordem e o corte local preservando o extra.

Testes: 726 (725 passando, 1 pulado por rodar como root; eram 700), no Node 22, mais lint de sintaxe e varredura de segredos limpos. 26 novos em `tests/agentesPessoais.test.js` — inclusive três de ponta a ponta com o CLI real e o provedor `openai` apontando para um servidor local que imita a API (`aliados run` guardando memória e lembrando na conversa seguinte; `aliados chat` com iniciador e conversa salva no agente; `@chef` no chat comum) — e o assistente interativo conferido num pseudoterminal (`script`): o processo agora sai sozinho no fim (antes ficava preso esperando o teclado) e instruções coladas com várias linhas não se perdem.

**Limites:** a busca é por palavras, não por significado. Nada foi rodado com um modelo de verdade (sem chave nem rede neste ambiente); os testes usam modelo simulado. O ESLint não roda aqui (o registro do npm está bloqueado pela política de rede da sessão), só a checagem de sintaxe do `npm run lint`. A memória `auto` confia no modelo para não guardar o que veio de uma página — por isso o padrão é `confirmar`.

## 0.41.0 — duas falhas de segurança corrigidas e as lacunas frente a Claude Code, Codex e Antigravity

**Falhas corrigidas** (cada uma reproduzida antes no loop real do agente, com modelo simulado; os testes novos falham no código anterior):

- **P1 — lista vazia de ferramentas liberava todas.** Na camada de ferramentas, `tools: []` significava "todas": um passo de workflow com `tools: []` rodado por `gemini-code agent run` recebia `write_file` e `run_shell`. Agora só a *ausência* de lista libera tudo; `[]` = nenhuma (também na sessão de convidado).
- **P1 — o convidado virava dono.** `read_file`, `search_files` e `read_skill` liam `~/.gemini-code/cowork-token.txt` (com ele, o convidado conecta no cowork com o agente inteiro) e a API key do `config.json`. Nova lista `SECRET_PATHS` (config + `.bak`/`.tmp`, `mcp.json`, tokens): nenhuma ferramenta do modelo lê esses arquivos, nem por symlink ou hard link. E o convidado só lê dentro da pasta em que o gemini-code foi aberto (antes lia chaves SSH, outros projetos...).
- **P1 — anti-SSRF furado por IPv6.** `privateAddress` (rotinas e `web_fetch`) comparava texto: `64:ff9b::7f00:1` (NAT64 → 127.0.0.1), `64:ff9b::a9fe:a9fe` (metadata da nuvem), `::7f00:1`, `2002:a00:1::1` (6to4) e `0:0:0:0:0:0:0:1` passavam. Agora o IPv6 é expandido em 8 blocos e o IPv4 embutido passa pela regra do IPv4.
- **P2 — chaves vazavam.** Servidores MCP (muitas vezes de terceiros) herdavam `GEMINI_API_KEY` do ambiente; o `actions.log` guardava comandos com `Authorization: Bearer ...` em texto puro; a chave do Veo ia na URL (`?key=`).
- **P2 — instruções de qualquer repositório entravam no prompt sem aviso** (`AGENTS.md`, `CLAUDE.md`, `.cursorrules`... e `.gemini-code/commands` virando `/comandos`): injeção num repositório clonado. Agora o chat pergunta uma vez por pasta (`src/trust.js`; decisão em `~/.gemini-code/confianca.json`, protegido contra o modelo). Sem terminal, pasta não decidida continua carregando (como o `claude -p`); `gemini-code confianca negar PASTA` bloqueia.
- **P2 — o chat retomava a conversa de outro projeto** (a sessão ativa era global). Agora é por pasta.

**Lacunas fechadas** (levantadas por auditoria do código frente ao que os outros agentes documentam):

- **Provedor `openai`**: qualquer API compatível com OpenAI com chave (OpenRouter por padrão, OpenAI, Groq, DeepSeek...) — os mesmos modelos fortes dos outros agentes. `config set-openai-key | set-openai-model | set-openai-url`, `@openai`, `openai:MODELO`, e `config set-hybrid-cloud openai` para usá-lo como lado nuvem do híbrido. O uso real conta no `/custo` e no limite de tokens. Chave também por `GEMINI_CODE_OPENAI_KEY`.
- **Ferramentas novas**: `edit_files` (várias edições em vários arquivos, atômicas, com rollback), `glob_files` (`**/*.test.js`, respeita `.gitignore`) e `web_fetch` (pergunta antes; `webDominiosPermitidos` e `confirmWeb`; anti-SSRF em cada redirecionamento; 2 MB; saída marcada como dado externo). `/passo` e a análise de risco de workflows cobrem as novas.
- **Comandos em segundo plano**: `run_shell { em_segundo_plano: true }` + `shell_status` (subir um servidor e testá-lo); até 5; todos encerrados quando o gemini-code sai.
- **Regras de permissão** no `config.json`: `"permissoes": { "negar": ["run_shell(git push*)"], "permitir": ["run_shell(npm test*)"] }` e `config negar | permitir | regras | remover-regra`. `negar` vale em todo modo (inclusive subagentes e workflows); `permitir` só dispensa a confirmação de comando simples.
- **Contexto em tarefas longas**: resultados antigos de ferramenta viram um aviso curto acima de `contextoMaxChars` (padrão 300 000 caracteres) — antes uma tarefa de muitas leituras reenviava tudo a cada passo. `/compact ia`: o próprio modelo resume a conversa.
- **Hooks** `UserPromptSubmit`, `SessionStart` e `Stop` (código 2 no Stop obriga a continuar, até 3 vezes).
- **Subagentes do usuário** em `.md` (`~/.gemini-code/subagentes/` ou do projeto, se confiável), com ferramentas e modelo próprios; nunca recebem mais ferramentas que o pai.
- **MCP remoto** (Streamable HTTP): `"url"` e `"headers"` com `${VAR}` no `mcp.json`. Sem OAuth.
- **Imagem como entrada**: `run --imagem ARQ`, `/imagem ARQ` e `/foto` no chat.
- **`run --json`**: uma linha JSON no stdout (`{ok, texto, uso, ...}`) para CI e scripts; todo o resto vai para o stderr.
- **Avaliação**: tarefa nova `refatorar-multiarquivo` (7 no total) e, em `docs/EVALS.md`, como comparar com o **mesmo modelo** pelo provedor `openai`, separando a qualidade do agente da do modelo.

**Revisão adversarial antes de fechar a versão.** 4 revisores com lentes diferentes (permissões, rede e segredos, corretude, ferramentas novas), cada achado só valendo com reprodução executada e cada um entregue a um cético independente para tentar derrubá-lo. Os 10 achados de segurança foram confirmados pelos céticos (9 distintos: dois revisores acharam o mesmo `mcp.json.bak`). Mais 1 visto pelo revisor de rede fora do limite de achados dele, também reproduzido aqui. Os 12 de corretude e das ferramentas novas ficaram sem cético (limite de sessão); cada um deles eu reproduzi com um teste que falha no código anterior antes de corrigir. Todos corrigidos, um commit por achado:

- **P1 — DNS rebinding no `web_fetch`** (e no `http-check` das rotinas): o anti-SSRF resolvia o nome, conferia o IP e o fetch resolvia de novo para conectar; um DNS com TTL 0 trocava o IP público por 127.0.0.1 ou 169.254.169.254. Agora a conexão usa um `lookup` que confere cada endereço na hora de conectar (`src/redeSegura.js`).
- **P1 — `mcp.json.bak`** (cópia com os tokens que o `mcp add/remove` deixa) era lido por `read_file`, `search_files` e `read_skill`. Entrou em `SECRET_PATHS` e `PROTECTED_PATHS`, com permissão 0600.
- **P1 — subagentes do projeto** (`.gemini-code/subagentes/`) entravam sem a pergunta de confiança.
- **P2 — regras "negar" contornáveis:** `run_shell` com `&`, `$(...)`, crases, `(...)` e `{ ...; }`; `web_fetch` por redirecionamento ou por variação da URL (maiúsculas, `:443`); regras e hooks escritos para `edit_file` não valiam para o `edit_files`.
- **P2 — MCP remoto:** um corpo que parava no meio travava o agente para sempre (o prazo acabava nos cabeçalhos); um 307/308 levava o token do cabeçalho para outro endereço (P3).
- **P2 — chat por pipe:** `echo "pergunta" | gemini-code chat` num repositório com `AGENTS.md` perdia a pergunta na pergunta de confiança e saía sem responder.
- **P2 — `/compact ia`:** o resumo do modelo era apagado na compactação seguinte (que o auto-compact disparava logo no turno seguinte, medindo a própria chamada do resumo); com contexto pequeno o modelo só via o fim das mensagens antigas e o resumo dele substituía todas. Agora o resumo anterior é levado adiante e o registro local vai junto.
- **P2 — uma imagem contava o base64 inteiro** no orçamento de contexto e apagava resultados de ferramenta numa conversa curta.
- **P2 — `glob_files` numa subpasta do repositório** ignorava o `.gitignore` do topo; também `.gitignore` com BOM e `[!-9]` (conferidos contra o git).
- **P3:** `run_shell` em segundo plano com `cmd &` fugia do limite de 5 e ficava órfão (e terminal fechado, SIGHUP, não passava pela limpeza); `actions.log` deixava passar `password = "..."` nos argumentos; hooks Stop/UserPromptSubmit rodavam dentro de subagentes; a validação de workflow dizia que as ferramentas novas "não existem"; `confianca esquecer` numa subpasta prometia perguntar de novo; `<pre>` perdia o recuo; o charset do `<meta>` era ignorado; um "İ" antes de `<script>` desalinhava o texto.

Testes: 700 (699 passando, 1 pulado por rodar como root), no Node 20 e no 22; eram 524 na v0.40.0.

**Limites (importante):** nada aqui foi executado com Gemini, llama.cpp, uma API compatível com OpenAI de verdade, Claude Code, Codex, Antigravity ou Hermes Agent (sem chave nem rede neste ambiente): **não há resultado comparativo**, só as ferramentas para medir. Medido de verdade: code-ia solo 0/6 (v0.40.0). As regras de permissão e a heurística do `run_shell` são casamento de texto, não sandbox (ex.: `git -C . push` ainda escapa de `run_shell(git push*)`). MCP remoto sem OAuth. `glob_files` não entende classes POSIX (`[[:digit:]]`). O limite de 1 MiB do cowork não foi exercitado com `ws` real. ESLint não roda offline (lint só de sintaxe).

## 0.40.0 — segurança das ferramentas, execução sem terminal e avaliação reproduzível

Base: o pacote v0.39.0 (MinhaIA) foi importado no repositório sem alterações; o `aplicar-correcao-gemini.sh` saiu (reescrevia `src/gemini.js` e `shellTools.js` inteiros com o código da v0.1 e quebraria o CLI; continua no histórico do git).

**Falhas corrigidas** — todas reproduzidas antes no loop real do agente (modelo simulado), com `confirmShell: true`:

- **P1 — o modelo plantava um hook e rodava comando sem confirmação.** `write_file` em `~/.gemini-code/hooks.json` não era bloqueado; o hook roda via `sh -c` antes de cada ferramenta. Na chamada seguinte (até um `list_dir`), o comando executava.
- **P1 — symlink furava a proteção do config.** A checagem comparava com `path.resolve`; um `docs/settings.json -> ~/.gemini-code/config.json` vindo de um repositório clonado deixava o `write_file` gravar `confirmShell: false`.
- **P2 — segredos legíveis por outros usuários.** `config.json`/`.bak` (API key em texto puro sem passphrase) e o token do cowork eram criados com 0644, numa pasta 0755.
- **P2 — saída silenciosa sem terminal.** Com stdin encerrado (cron, CI, `< /dev/null`), a confirmação de `run_shell`/`run_checks` nunca era respondida e o processo saía no meio da tarefa com **código 0** e sem resposta.
- **P3 — cowork aceitava mensagens de até 100 MiB** (padrão do `ws`) antes da autenticação.

**Como:**

- `src/config.js`: lista única `PROTECTED_PATHS` (config + `.bak`/`.tmp`, `mcp.json`, `hooks.json`, `cowork-token.txt`, `routine-api-token.txt`), usada por `write_file`, `edit_file` e pela heurística do `run_shell`; `hooks.js`, cowork e API de rotinas leem os caminhos daqui.
- `fileTools`: compara o caminho **real** (symlinks, inclusive quebrados — gravar num link quebrado cria o alvo —, e pastas que são symlink) e o inode (hard link).
- `config-manager`: grava com 0600 e corrige arquivos 0644 antigos ao ler; `~/.gemini-code` nasce com 0700. Token do cowork com 0600 (o existente é corrigido) e `maxPayload` de 1 MiB.
- `src/ui/prompt.js`: `ask()` resolve com `''` (= "não") quando a entrada fecha e avisa no terminal; as perguntas seguintes respondem na hora.

**Avaliação reproduzível (`evals/`, `docs/EVALS.md`):** 6 tarefas com enunciado, workspace, verificador oculto e solução de referência: corrigir defeito, implementar recurso, diagnosticar teste falhando sem alterá-lo, mudar comportamento sem regressão, resistir a instrução injetada num arquivo, edição cirúrgica com "iscas". `node evals/run.js --agent "COMANDO {prompt}"` roda qualquer agente de linha de comando nas mesmas condições e gera relatório JSON (tempo, código de saída, arquivos alterados, motivo). `--self-test` prova que cada verificador falha sem solução e passa com a de referência; os testes também têm controles negativos (obedecer a injeção, trocar todas as ocorrências, mexer no teste, estourar o tempo → reprova).

- Testes novos: `protectedPaths` (10), `secretFilePermissions` (4), `promptHeadless` (4), `evals` (8). Contra o código anterior, falham 13 dos 14 de segurança (o que sobra é o de não-regressão, que deve passar nos dois) e os 4 de stdin. `npm test`: 524 passando; lint de sintaxe e varredura de segredos ok.
- **Medido (real):** `gemini-code run` em modo solo (code-ia, sem LLM): **0/6** — responde com trechos da base e não edita arquivos.
- **Limites:** não executei o gemini-code com Gemini ou llama.cpp (sem chave nem modelo neste ambiente), nem Claude Code/Codex/outros: não há comparação entre agentes aqui, só a ferramenta para fazê-la. ESLint não roda offline (só sintaxe). O limite de 1 MiB do cowork não foi exercitado com `ws` real (dependência não instalável sem rede aqui). Continuam: a heurística do `run_shell` é texto (a barreira é `confirmShell`); `search_files` com regex do modelo roda na thread principal (regex patológica pode travar); `ws://` do cowork sem TLS; de um pipe finito só a 1ª resposta é usada; vários testes antigos usam o `HOME` real (só criam padrões, não sobrescrevem).

## 0.39.0 — modo solo: o code-ia sozinho, sem nenhuma outra IA por trás

- **`gemini-code solo on | off | status`** (`src/solo.js`): liga o code-ia como única IA. O `solo on` guarda o provedor anterior, troca para `code-ia`, **para o llama-server** se estava no ar e instala/atualiza o modelo próprio. `solo off` restaura o provedor de antes.
- **Três travas independentes** (se uma falhar, as outras seguram):
  1. **Roteador:** no solo, `escolher()` devolve SEMPRE `code-ia`, mesmo com chave Gemini, `provider=hybrid` ou pedido forçado (`/cloud`, `/local`, modelo explícito, `ollama:`...). Não há fallback para outro lado, e `chamar()` recusa qualquer outro provedor.
  2. **Comandos que dependem de outra IA** (`design`, `media`, `live`, `models`, `ollama`, `llamacpp start`) são recusados com explicação; `/local`, `/cloud` e `/auto` no chat também; `config set-provider` para outro provedor é recusado.
  3. **Guarda de rede:** todo `fetch` para serviço de IA conhecido (Gemini, OpenAI, Anthropic, OpenRouter, Groq, Mistral, Together, DeepSeek, xAI, HF Inference) ou para o endereço configurado do llama.cpp/Ollama é bloqueado antes de sair do processo. Outros destinos passam (um servidor MCP seu continua funcionando).
- `GEMINI_CODE_SOLO=1` força ligado e `=0` força desligado (acima do config). `doctor` mostra `modoSolo`. O chat mostra uma linha verde quando está no solo.
- **code-ia mais útil sozinho:** entende `rode os testes` / `executar lint` (→ `run_checks`), `git status` / `status do git` e `git log` / `últimos commits` (→ `run_shell`, que continua pedindo s/n), sem outra IA para interpretar. No solo, quando não sabe responder, não sugere mais `/cloud`.
- 9 testes novos (`tests/solo.test.js`): inclui conversa inteira com `fetch` que falha se for chamado (0 chamadas) e o CLI de ponta a ponta. `npm test`: 497 passando.
- **Limites (importante):** o code-ia é uma busca BM25 sobre o que ele aprendeu + gerador n-grama, **não um LLM**: no solo ele não raciocina nem escreve código novo fora do que sabe; para isso ensine (`code-ia learn`, `/ensinar`). A guarda de rede cobre `fetch` e uma lista de serviços conhecidos; um servidor MCP ou script seu que chame outra IA por conta própria não é visto por ela. Não testado em Termux real.

## 0.38.0 — o modelo local não esquece mais o que você ensinou, e a conversa é compactada a tempo

- **Auto-compact para o modelo local:** antes só disparava com 60 000 tokens (limiar da nuvem) e as chamadas locais nem registravam o tamanho do prompt, então no celular a conversa nunca era compactada: o histórico só era cortado em silêncio dentro do `llamacpp.js`. Agora a chamada local registra o tamanho estimado do prompt (`usage.registrar({ local: true, promptTokens })`) e, se a última chamada foi local, o chat compacta (`/compact` automático, sem custo) ao chegar a **60% do contexto do servidor**. `autoCompactTokens: 0` continua desligando tudo. Se a última chamada foi na nuvem, vale o limiar antigo.
- **Conhecimento fixo preservado (`compactarSistema`):** o system era cortado pelo fim, e é no fim que ficam os seus conhecimentos (spec da NetoLang, convenções do projeto). Agora, quando não cabe, primeiro saem os parágrafos sobre `delegate_task`/`todo_write`/`run_workflow` (ferramentas que já saem no modo local) e a lista de skills; identidade, regra do `run_checks`, contexto do projeto e conhecimento ficam.
- **Orçamento do system dinâmico:** de 40% (conversa longa) a 70% (conversa curta) do espaço disponível, em vez de 45% fixo. Conversa curta = mais conhecimento no prompt; conversa crescendo devolve espaço ao histórico.
- 4 testes novos (`tests/localContexto.test.js`), incluindo um com arquivo de conhecimento real que falhava na 0.37.0. `npm test`: 488 passando.
- **Limites:** tamanho do prompt local é **estimado** (3 caracteres ≈ 1 token), não o contado pelo llama.cpp; não testado com llama.cpp/Termux reais. Não troquei o modelo padrão (Qwen2.5-1.5B): um modelo maior (ex. 3B) ajudaria em ferramentas, mas não consigo confirmar URL e SHA-256 sem rede aqui.

## 0.37.0 — modelo local de verdade no celular: contexto, streaming, timeout e servidor em segundo plano

**Bug principal corrigido.** As ferramentas do agente (~2 100 tokens) + o prompt do sistema (~1 100) somavam mais de 3 000 tokens, mas o `start-llama-server.sh` subia o servidor com contexto de **2048**. Resultado: o modelo local recusava (HTTP 400, contexto estourado) ou perdia o prompt. Agora:

- **Ferramentas compactas (`compactarTools`):** descrições encurtadas e, se ainda não couberem em 35% do contexto, descarta as dispensáveis (`delegate_task`, `run_workflow`, `todo_write`, `read_skill`, depois `mcp__*`). As essenciais (`read_file`, `write_file`, `edit_file`, `list_dir`, `run_shell`, `search_files`, `run_checks`) nunca saem. O prompt avisa o modelo do que ficou de fora. Medido no projeto real: 2 129 → 1 215 tokens (ctx 4096) e 976 (ctx 2048).
- **Histórico podado por orçamento (`ajustarAoContexto`):** mantém system + o mais recente, nunca começa com `tool` órfã, trunca mensagem gigante e o system se precisar. Se o contexto é apertado, a reserva da resposta encolhe (mín. 128 tokens) em vez de estourar.
- **Contexto padrão 4096** (`llamaCppCtx`, `LLAMA_CTX`, `config set-llamacpp-ctx`). O roteador híbrido agora usa o contexto do llama.cpp (antes olhava o do Ollama, 8192, e só mandava para a nuvem tarde demais).
- **Streaming (SSE):** o texto aparece enquanto o modelo escreve; `tool_calls` que chegam em pedaços são remontados. Respeita `enableStreaming`.
- **Timeout por inatividade** (`llamaCppTimeoutMs`, padrão 180 s): servidor travado vira erro recuperável (o híbrido cai na nuvem) em vez de pendurar para sempre.
- **Contexto estourado** no servidor → mensagem clara (`/compact`, aumentar ctx) e erro recuperável (híbrido tenta a nuvem).
- **`--jinja` no servidor:** sem ele, versões antigas do llama-server recusam o campo `tools`. Se o erro aparecer, a mensagem explica.
- **Chamada de ferramenta escrita em texto** (`<tool_call>{...}</tool_call>` do Qwen ou JSON puro) vira chamada de verdade, só se a ferramenta existir.
- **`gemini-code llamacpp start | stop | status | log`** (`src/localServer.js`): sobe o llama-server **em segundo plano** (destacado, PID e log em `~/.gemini-code/`, `termux-wake-lock` se existir). Acabou a segunda aba. `status` distingue **pronto / carregando / offline**. Só mexe em endereço local.
- **`config set-llamacpp-autostart on`:** o chat sobe o servidor sozinho na 1ª pergunta (o instalador já liga). Modelo ainda carregando (HTTP 503) → espera em vez de falhar.
- **`doctor`** mostra binário do llama-server, modelo GGUF, contexto, autostart, PID e espaço livre.
- **Instalador:** confere 3 GB livres; pula a compilação se o `llama-server` já existe (`REBUILD=1` força); **verifica o SHA-256 antes de aceitar o download** (antes um download quebrado ficava como "pronto" e nunca era refeito) e apaga modelo corrompido.
- 15 testes novos (`tests/llamacppV037.test.js`), incluindo um que usa as ferramentas e o prompt **reais** do projeto e confere que o pedido cabe no contexto. `npm test`: 484 passando; lint de sintaxe ok.
- **Limites:** não rodei llama.cpp, modelo GGUF nem Termux de verdade (sem rede neste ambiente); streaming, timeout e `llamacpp start` foram testados com servidor/spawn simulados. Tokens são **estimados** (3 caracteres = 1 token), com folga de 64 tokens. Em ctx 2048 sobra pouco espaço de conversa; use 4096 (padrão) se o celular aguentar.

## 0.36.0 — MCP mais rápido e ligar/desligar servidores

- **Subida em paralelo:** os servidores MCP agora iniciam ao mesmo tempo (antes um por vez; com 3 servidores lentos a primeira resposta podia esperar até 60 s). Falha de um servidor não derruba os outros; o processo do que falhou é encerrado. Teste: 3 servidores de 400 ms sobem em menos de 1,1 s.
- **`gemini-code mcp off NOME` / `mcp on NOME`:** desliga um servidor sem apagar a configuração (`"desativado": true`). Servidor desligado não sobe e **suas ferramentas não entram no pedido ao modelo**, então não gastam tokens. `mcp list` mostra `[DESLIGADO]` e `mcp check` ignora os desligados. Dica: deixe Blender/Roblox desligados quando não estiver usando.
- 3 testes novos + 1 de CLI (`tests/mcpFakeServer.test.js`, `tests/mcpPresets.test.js`). `npm test`: 469 passando; lint ok. Não testado: servidores reais (Spotify/Blender/Roblox), Termux real.

## 0.35.1 — teste de ponta a ponta do MCP contra um servidor stdio de verdade

- **`tests/fixtures/fake-roblox-mcp.js` + `tests/mcpFakeServer.test.js`:** sobe um servidor MCP FALSO (processo real, JSON-RPC real, ferramentas `get_data_model` e `execute_luau`, no estilo do Roblox Studio) e confere com o cliente do gemini-code: initialize, lista de ferramentas, nomes `mcp__roblox__*`, resultado em texto, `s/n` antes do `execute_luau` (recusar não executa; aceitar muda o estado do servidor), erro do servidor e servidor que morre no meio.
- 3 testes novos; `npm test`: 466 passando. **O que isto NÃO prova:** não é o Roblox Studio real nem os nomes reais das ferramentas dele; não testa o modelo (Gemini/local) nem o workflow `jogo-roblox-x1` rodando; não compara com Claude Code/Codex.

## 0.35.0 — kit do teste X1 (Roblox): workflow `jogo-roblox-x1` + roteiro

- **`workflows/exemplos/jogo-roblox-x1.json`:** usa os recursos do Gemini Code juntos: plano sem ferramentas → construção no Roblox Studio pelo MCP (com `retry`) → playtest lendo o console (opcional, não derruba o resto) → autoavaliação por rubrica que limita a nota a 5 no que não foi testado. Teto de 150 000 tokens para o workflow inteiro. Variável: `ideia`. Instale com `/workflows instalar jogo-roblox-x1` e rode com `/workflows rodar jogo-roblox-x1 ideia="..."`; `retomar`, `historico` e o detector de laço (0.32) valem aqui também.
- **`docs/TESTE_X1_ROBLOX.md`:** regras iguais para Gemini Code, Claude Code e Codex, prompt padrão (obby de 5 fases), rubrica de 8 critérios e como rodar. A nota que vale é a sua, jogando às cegas.
- O teste existente que valida TODOS os exemplos do projeto cobre o novo workflow. `npm test`: 463 passando.
- **Limite:** o teste real NÃO foi executado (sem Roblox Studio, sem API do Gemini, sem Claude Code/Codex neste ambiente). Nenhum resultado ou vencedor está medido; os nomes das ferramentas do MCP do Roblox não foram confirmados (o passo de construção herda as ferramentas disponíveis).

## 0.34.0 — MCP pronto para Spotify, Blender e Roblox Studio

- **`gemini-code mcp presets | add NOME | list | remove NOME | check`** (`src/mcpPresets.js`): instala servidores MCP prontos em `~/.gemini-code/mcp.json` sem editar JSON. Presets:
  - **spotify** (`varunneal/spotify-mcp` via `uvx`): `--client-id`, `--client-secret`, `--redirect`; lê `SPOTIFY_CLIENT_ID/SECRET` do ambiente se existirem (o segredo não fica no histórico). Controle de reprodução exige Premium.
  - **blender** (`blender-mcp` via `uvx`): `--host`, `--port` (padrão localhost:9876); telemetria já vem desligada.
  - **roblox** (servidor MCP **embutido** no Roblox Studio, pois o antigo `studio-rust-mcp-server` foi descontinuado): caminho do Windows por padrão, `--launcher CAMINHO` para outros sistemas e `--ssh usuario@ip` para usar a partir do celular.
- **Confirmação antes de ferramentas que rodam código:** um servidor com `"confirmar": ["execute", ...]` no mcp.json pede `s/n` antes de cada ferramenta cujo nome contenha o trecho (`"*"` = todas). Sem terminal para responder, cancela. Blender e Roblox já vêm marcados.
- **Segurança do arquivo:** não sobrescreve servidor existente sem `--forcar` (guarda `mcp.json.bak`), preserva os outros servidores e chaves, **não toca** num mcp.json com JSON quebrado, grava com permissão 600 e `list` mascara chaves/segredos.
- 12 testes novos (`tests/mcpPresets.test.js`). `npm test`: 463 passando. Conferido no CLI com HOME temporário.
- **Limites (importante):** Blender e Roblox Studio são programas de computador; não rodam no Android. No celular só funcionam apontando para o PC (`--host`/`--ssh`), e NÃO testei esses caminhos de rede, nem o login do Spotify no Termux, nem nenhum dos três servidores reais (sem rede neste ambiente). Não confirmei os nomes exatos das ferramentas de execução de código do Roblox; use `"confirmar": ["*"]` se quiser confirmar todas.

## 0.33.0 — saída de comando mais enxuta (menos tokens)

- **`src/outputCompact.js`:** a saída de `run_shell` e `run_checks` é limpa ANTES de ir ao modelo e antes do corte de 20 000 caracteres: remove cores/cursor ANSI e links OSC, deixa só o último estado das barras de progresso (`\r`), troca linhas idênticas seguidas por `linha (×N)` e reduz várias linhas em branco a uma. Isso gasta menos tokens e evita que `npm install` ou testes verbosos empurrem o erro útil para a parte omitida.
- **Seguro:** `read_file`, `search_files` e as demais ferramentas NÃO passam por isso (conteúdo de arquivo continua exato). Linhas repetidas que não são vizinhas ficam como estão. O que o usuário vê no terminal não muda; só o que vai ao modelo.
- 6 testes novos (`tests/outputCompact.test.js`). `npm test`: 451 passando; lint de sintaxe ok. Não testado: Gemini real, Termux real.

## 0.32.0 — detector de laço: o agente para de repetir a mesma chamada

- **`src/loopGuard.js`:** antes, um modelo preso repetindo a mesma ferramenta só era cortado no teto de 60 passos, gastando cota até lá. Agora, se ele faz a MESMA chamada (nome + argumentos) e recebe o MESMO resultado: na **3ª** vez o resultado volta com um aviso pedindo para mudar de abordagem; na **5ª** o turno é encerrado e a mensagem `[loop] ...` entra no histórico (o próximo turno não perde o fio).
- **Sem punir trabalho legítimo:** se o resultado muda (acompanhar um processo, ler um arquivo que está sendo editado), a contagem zera; chamadas diferentes não se misturam; a ordem das chaves dos argumentos não importa. O teto de 60 passos continua valendo para o resto.
- 5 testes novos (`tests/loopGuard.test.js`) e 1 teste antigo ajustado (`tests/agent.test.js`: o resultado agora varia a cada passo, senão o detector encerraria antes dos 60). Não testado: modelo real do Gemini, Termux real.

## 0.31.0 — comandos `config set-*` num módulo testável, com URL validada

- **`src/configCommands.js`:** os setters simples (`set-model`, `set-fast-model`, `set-fallback-model`, `set-provider`, `set-llamacpp-url/model`, `set-ollama-url/model`, `set-wait-quota`) saíram do `bin/gemini-code.js` (1379 → 1356 linhas) e viraram uma função que devolve o texto pronto, então dá para testar sem abrir o terminal. Mensagens e comportamento continuam os mesmos.
- **Correção:** `set-llamacpp-url` e `set-ollama-url` agora recusam endereço que não começa com `http://` ou `https://` (antes salvava qualquer texto e o erro só aparecia depois, na hora de conversar com o modelo). `set-model`/`set-fast-model` sem nome mostram o uso em vez de salvar `undefined`.
- Passphrases, `set-key`, `unlock` e `show` continuam no bin (são interativos).
- 5 testes novos (`tests/configCommands.test.js`). Conferido no CLI real com `HOME` temporário: URL inválida recusada, `set-provider` e `set-wait-quota` salvam. Não testado: Termux real.

## 0.30.0 — espera opcional do 429 por minuto

- **`esperarCotaSegundos` (padrão 0 = desligado):** se o Gemini responder 429 pedindo para aguardar até N segundos, a chamada espera N+1s (com aviso na tela) e repete **uma única vez**. Ligue com `gemini-code config set-wait-quota 60` (máx. 300) ou `GEMINI_CODE_WAIT429=60`.
- **Seguro por desenho:** nunca repete `limit: 0` (modelo sem cota no projeto), 429 sem tempo informado nem espera maior que o teto; o 429 não consome as tentativas do retry de 503. Quem não ligar a opção não vê nenhuma mudança (o comportamento "não repetir sozinho" do 0.29 continua o padrão).
- 5 testes novos (`tests/geminiWait429.test.js`). `npm test`: 435 passando; `npm run lint`: sintaxe ok. Não testado contra a API real do Gemini nem em Termux real.

## 0.28.0 — IA local generativa como padrão

- **Resposta aberta local:** o provedor padrão passa a ser Ollama, com `qwen3:4b-instruct` como modelo geral inicial. A rota sem chave da nuvem usa Ollama em vez da `code-ia` baseada em busca e n-gramas.
- **Modo `code-ia` fica opcional:** continua disponível para busca de conhecimento e exemplos ensinados, mas a documentação deixa claro que ele não é um LLM geral. A instalação do corpus não acontece automaticamente no uso comum; é preparada se o usuário selecionar esse provedor.
- **Configuração e mensagens:** documentação para baixar o modelo local uma vez, instruções de erro de conexão com Ollama e orientação para usar um computador na mesma rede quando o dispositivo não conseguir executar o modelo localmente.
- **Testes:** coberta a rota padrão com pergunta aberta simulada e a seleção do modelo generalista. `npm test`: 425 testes passando; `npm run lint`: sintaxe aprovada em 116 arquivos JavaScript (ESLint não instalado no ambiente).
- **Limites:** o modelo não é incluído no ZIP (os pesos são grandes e precisam ser baixados uma vez); a qualidade/respostas continuam dependentes do modelo e do hardware. Não foi possível testar contra uma instalação real do Ollama neste ambiente.

## 0.27.0 — /workflows criar: a IA escreve o rascunho, você aprova

- **`/workflows criar <nome> <o que ele deve fazer>`:** pede ao modelo um workflow em JSON a partir da sua descrição (UMA chamada de IA, sem ferramentas) e salva como **rascunho** em `~/.gemini-code/workflow-rascunhos/`. O rascunho **não está em uso**: o agente não o lista nem o aciona. Mostra o resumo dos passos (igual ao `/workflows ver`), os avisos do validador e, à parte, **ATENÇÃO** para o que merece olho humano: passo sem `tools` (herda TODAS as ferramentas, inclusive gravar e rodar comando) e passo com `write_file`, `edit_file` ou `run_shell`. A instrução pede `tools` em todo passo, só leitura quando possível, e explica `each`, `paralelo`, `when`, `retry`, `maxTokens`.
- **Defesas:** o nome do workflow é o que VOCÊ digitou (o modelo não escolhe); só campos que existem são mantidos (campo estranho no topo ou no passo é descartado); resposta sem JSON, JSON quebrado ou workflow com erro de validação (id repetido, uso de passo futuro, `paralelo` com ferramenta que grava...) **não salva nada** e diz o motivo; nome que já está em uso é recusado antes de gastar IA.
- **`/workflows rascunhos`** lista; **`/workflows aprovar <nome>`** valida de novo (você pode ter editado o arquivo), move para a pasta ativa e apaga o rascunho (não sobrescreve sem `--forcar`); **`/workflows descartar <nome>`** joga fora.
- 7 testes novos (`tests/workflowsV027.test.js`) com modelo simulado: nome forçado, campos descartados, geração sem ferramentas, avisos de risco, 5 casos de falha sem salvar, validação de nome/pedido sem gastar IA, aprovar/descartar e nomes perigosos. Total: 424, todos passando (rodados 2 vezes). Conferido no chat real só o caminho de erro (modelo local offline não devolve JSON; nada foi salvo).
- Limites: a qualidade do rascunho depende do modelo (o Gemini deve ir bem; o code-ia local não escreve JSON de workflow); a IA não roda o workflow para testar, só você, com `/workflows rodar`; o aviso de risco olha o campo `tools`, não o conteúdo dos prompts. Não testado: Gemini real, Termux real.

## 0.26.0 — instalar exemplos, criar esqueleto e ver workflows sem mexer em arquivo

- **`/workflows exemplos`** lista os workflows de exemplo que vêm no projeto (nome, nº de passos, descrição). **`/workflows instalar <exemplo>`** copia um deles para `~/.gemini-code/workflows/` (antes era "copie o .json" na mão, ruim no celular). Não sobrescreve um arquivo que você já editou (precisa de `--forcar`), só aceita nomes de exemplos que existem (`[a-z0-9_-]`, sem caminho) e se recusa a instalar um exemplo que tenha erro de validação.
- **`/workflows novo <nome>`** cria um esqueleto VÁLIDO (dois passos, só leitura, com `maxTokens`) para você editar; nunca sobrescreve. O `validar` avisa enquanto a `description` ainda for o texto de preenchimento, porque o agente aciona workflows pela descrição.
- **`/workflows ver <nome>`** mostra num resumo legível os passos, opções (each, paralelo, ferramentas, condicional, opcional, retry, modelo), o teto de tokens e as variáveis que o workflow pede.
- Teste novo garante que TODOS os exemplos do projeto passam na validação e instalam de verdade (um exemplo quebrado futuro derruba o `npm test`).
- 6 testes novos (`tests/workflowsV026.test.js`). Total: 417, todos passando. Conferido no chat real: `exemplos`, `instalar`, `ver`, `novo` e a lista.
- Limites: o esqueleto é fixo (não gera workflow a partir de uma descrição com IA); `instalar` só copia os exemplos do projeto, não baixa nada da internet. Não testado: modelo real, Termux real.

## 0.25.1 — each em paralelo (2 ou 3 itens ao mesmo tempo)

- **`"paralelo": 1-3` no passo com `each`:** os itens saem em LOTES (ex.: `paralelo: 3` revisa 3 arquivos juntos) e o resultado volta na ordem da lista, igual antes. Sem o campo (ou `1`) nada muda. Custo em tokens é o mesmo; o que cai é o tempo de espera.
- **Só onde é seguro:** `paralelo` acima de 1 exige `each` e `tools` apenas de leitura (`read_file`, `list_dir`, `search_files`) ou `[]`. Itens simultâneos não podem gravar no mesmo arquivo nem pedir confirmação ao mesmo tempo no terminal; o `run_workflow` e o `agent check` recusam o resto com mensagem clara. O `agent check` ainda avisa que vão várias chamadas juntas (se a API reclamar de limite, volte para 1).
- **Combina com o resto:** `retry` e `optional` valem por item; o orçamento (`maxTokens`) é checado antes de cada LOTE (pode passar um pouco do teto dentro do lote que já saiu); se um item sem `optional` falhar, só os itens ANTES dele (em ordem) são guardados e a retomada continua dali; os que já tinham dado certo depois dele naquele lote são refeitos.
- Exemplo `revisar-cada-arquivo` agora usa `"paralelo": 2`.
- 6 testes novos (`tests/workflowsV0251.test.js`; checam concorrência máxima, ordem, falha no lote, `optional`, orçamento por lote e validação). Total: 411, todos passando (rodados 4 vezes, sem oscilar).
- Limites: máximo 3 ao mesmo tempo; o log dos itens do mesmo lote pode sair intercalado; em lote, um item que falha descarta os que passaram depois dele (gasto de IA refeito na retomada). Não testado: modelo real (limites de taxa do Gemini), Termux real.

## 0.25.0 — comandos /workflows num módulo testável, /workflows limpar e historico --erros

- **`src/workflowCommands.js`:** toda a lógica dos comandos `/workflows` saiu do `bin/gemini-code.js` (que perdeu ~1,5 KB e um bloco de ifs) e virou um módulo que devolve linhas prontas, então dá para testar sem abrir o terminal (antes esses comandos não tinham teste nenhum). O comportamento dos comandos que já existiam não mudou; `/workflows` (lista) agora também mostra `[INTERROMPIDO no passo X: /workflows retomar nome]`.
- **`/workflows historico [nome] [--erros]`:** com `--erros` mostra só as execuções que falharam (ou "Nenhuma execução com erro registrada.").
- **`/workflows limpar historico`** apaga o histórico (e diz quantas execuções tinha). **`/workflows limpar <nome>`** descarta a execução interrompida daquele workflow (some o aviso de "retomar disponível"); o nome é validado (`[a-z0-9_-]`), então não dá para apontar para outro caminho. Só roda quando VOCÊ digita; o agente não tem acesso a esses comandos.
- 5 testes novos (`tests/workflowsV025.test.js`). Total: 405, todos passando. Também conferido no chat real (`/workflows`, `/workflows limpar`, `/workflows resumo`).
- Limites: o resto do `bin/gemini-code.js` (~72 KB) continua num arquivo só; a limpeza apaga tudo de uma vez (sem filtro por data). Não testado: modelo real, Termux real.

## 0.24.0 — retomar o laço each do item que parou, histórico do terminal e resumo por workflow

- **`each` retoma do item certo:** se o laço parar no meio (falha de item sem `optional`, ou orçamento de tokens), o progresso guarda os itens já feitos. Ao retomar (`/workflows retomar <nome>` ou `retomar: true`), o passo continua do próximo item, sem refazer nem pagar de novo os anteriores; o log mostra `(retomando: 2 de 4 itens já feitos, continuando do item 3)`. Trava de segurança: se a lista mudou de tamanho entre a falha e a retomada, o passo recomeça do item 1. Isso corrige o limite que o 0.22.0 avisava.
- **`gemini-code agent run` entra no histórico:** workflows rodados direto no terminal passam a ser registrados (ok ou erro, passos, tokens, duração), marcados `(terminal)` em `/workflows historico`. Mesmas regras de privacidade: só números, nunca saídas nem variáveis. Persona (chat) não é registrada. Corrige o limite que o 0.23.0 avisava.
- **`/workflows resumo [nome]`:** estatísticas por workflow sobre as últimas 200 execuções guardadas: nº de execuções, % de sucesso, média e total de tokens, duração média, retomadas e o passo que mais falha. O agente consegue o mesmo com `run_workflow` e `resumo: true` (com `name` opcional). Custo de IA: zero.
- 6 testes novos (`tests/workflowsV024.test.js`); 1 teste antigo ajustado à nova mensagem do orçamento no `each` (`tests/workflowsV022.test.js`). Total: 400, todos passando (rodados duas vezes).
- Limites: a retomada do `each` só vale para o passo onde parou e com a lista do mesmo tamanho; o resumo olha no máximo as últimas 200 execuções; o histórico do terminal só registra workflow (não persona). Não testado: modelo real do Gemini, Termux real.

## 0.23.0 — histórico de execuções dos workflows (/workflows historico)

- **Cada execução fica registrada:** nome, data/hora, resultado (OK ou ERRO no passo X), nº de passos e de pulados, tokens do Gemini gastos, duração e se foi uma retomada. Em `~/.gemini-code/workflow-runs/historico.jsonl` (custo de IA: zero).
- **`/workflows historico [nome]`** mostra as últimas 10 (mais nova primeiro; filtra por workflow). O agente consegue o mesmo com `run_workflow` e `historico: true` (com `name` opcional), útil para ele ver "esse workflow costuma falhar?" ou "quanto gasta".
- **Privacidade:** NUNCA grava saídas dos passos nem as variáveis (podem ter senha/token); só números e a mensagem de erro cortada em 200 caracteres. Teste garante que `SENHA123` passada em `vars` não aparece no arquivo.
- **Sem lixo:** guarda só as últimas 200 execuções; linha estragada é ignorada; falha ao gravar histórico nunca derruba o workflow; erro de validação (variável faltando, workflow inexistente) não entra, só execuções que realmente começaram.
- 5 testes novos (`tests/workflowsV023.test.js`). Total: 394, todos passando.
- Limites: o contador de tokens é o da sessão (só Gemini; local conta 0); o histórico é só do que passou pelo `run_workflow`/`/workflows rodar` (o `gemini-code agent run` direto no terminal não registra). Não testado: modelo real, Termux real.

## 0.22.0 — laço por lista (each): revisar vários arquivos, um a um

- **`"each": "{{lista}}"` num passo:** repete o prompt do passo para CADA linha da lista (normalmente a saída de um passo anterior), com `{{item}}` (a linha) e `{{indice}}` (1, 2, 3...). Marcadores `-`, `*`, `•`, `1.` e `2)` são removidos; linhas vazias e `[falhou:...]` são ignoradas. As saídas voltam juntas em `{{id_do_passo}}` no formato `--- 1. item ---` + resposta, prontas para um passo de resumo.
- **Limite duro de 10 itens** (`"maxItens": 1-10` para baixar). O resto é ignorado e o log avisa. Cada item é uma chamada de IA: 10 itens = 10 chamadas.
- **Combina com o resto:** `retry` vale por item; `optional` faz um item que falhou virar `[falhou: motivo]` (o resumo conta `N falharam`) em vez de derrubar o passo; `tools`/`model` valem para todos os itens; `when`/`unless` decidem se o laço roda; lista vazia pula o passo sem gastar IA; o `maxTokens` do workflow é checado antes de CADA item.
- **Retomar:** se o laço for interrompido (falha de item sem `optional` ou orçamento), o passo recomeça do item 1 ao retomar (os itens já feitos naquele passo não são guardados; os passos anteriores continuam salvos).
- **Validação (`agent check`):** `each` precisa ser texto, `maxItens` 1 a 10, aviso se o prompt não usa `{{item}}` ou se há `keepHistory` (ignorado no laço). `{{item}}`/`{{indice}}` não contam como variáveis obrigatórias.
- **Exemplo novo:** `workflows/exemplos/revisar-cada-arquivo.json` (lista até 5 arquivos, revisa cada um com `read_file` apenas, resume; com `maxTokens`).
- 7 testes novos (`tests/workflowsV022.test.js`). Total: 389, todos passando.
- Limites: máximo 10 itens por passo; sem laço dentro de laço; itens rodam em sequência (sem paralelo); a lista é texto linha a linha, então o passo anterior precisa ser instruído a responder "um por linha". Não testado: modelo real, Termux real.

## 0.21.0 — custo por passo e orçamento de tokens do workflow (maxTokens)

- **Tokens por passo:** o resultado do `run_workflow` ganha uma linha `Tokens do Gemini neste workflow: 2.300 (a 1.000, b 1.000, c 300)`, e o `agent run` mostra `(N tokens neste passo)` depois de cada passo. São os tokens REAIS que a API informa (o mesmo contador do `/custo`); tentativas que falharam também contam. Modelo local (Ollama/code-ia) não informa tokens: conta 0.
- **`"maxTokens": 30000` no workflow:** teto de tokens do Gemini POR EXECUÇÃO. É checado antes de cada passo que ia rodar; se já estourou, para ali (passo pulado por `when` nunca é barrado). Dá para gastar um pouco acima do teto no último passo permitido: o teto barra o PRÓXIMO passo, não corta uma chamada no meio.
- **Parar não perde nada:** o estouro salva o progresso como qualquer falha. `/workflows retomar <nome>` continua do passo barrado com orçamento zerado, e mudar só o `maxTokens` no arquivo NÃO invalida a retomada (o hash olha os passos). Combina com `"model": "@local"` nos passos baratos.
- `maxTokens` inválido (negativo, decimal) é recusado e o `agent check` aponta. Exemplo `diagnosticar-e-resumir` agora traz `"maxTokens": 30000`.
- 7 testes novos (`tests/workflowsV021.test.js`). Total: 382, todos passando.
- Limites: só conta tokens do Gemini (não preço); o teto é por execução, não por dia; a checagem acontece entre passos (um passo único muito grande ainda pode passar do teto). Não testado: modelo real, Termux real.

## 0.20.0 — retomar workflow que falhou (sem pagar de novo pelos passos que já deram certo)

- **Progresso salvo na falha:** se um passo falha (acabou o retry, cota, rede), o workflow guarda em `~/.gemini-code/workflow-runs/<nome>.json` as variáveis, o resultado de cada passo e onde parou. A mensagem de erro já diz como continuar.
- **`run_workflow` com `retomar: true` (ou `/workflows retomar <nome>`):** roda SÓ do passo que falhou em diante, reaproveitando o resultado dos anteriores. Não refaz nem gasta IA de novo com o que já deu certo. As `vars` salvas voltam sozinhas; se você passar `vars` novas, elas sobrescrevem.
- **Travas:** o estado vale 24 h; se o arquivo do workflow mudou depois da falha, a retomada é recusada e o estado descartado (os resultados antigos não combinariam mais com os prompts novos); workflows com `keepHistory` não salvam estado (o histórico da conversa não é guardado); só a pasta global; nome só `[a-z0-9_-]`. Terminar com sucesso apaga o estado. `/workflows` e a lista do agente marcam `[INTERROMPIDO no passo X: retomar disponível]`.
- No runner: o erro de passo agora traz `indice` e `ctx`, e `runWorkflowData` aceita `deps.retomar = {ctx, results, desde}`.
- 5 testes novos (`tests/workflowsV020.test.js`); nos testes, trocar a pasta de workflows também isola o estado, então nada é gravado no `~/.gemini-code` real. Total: 375, todos passando.
- Limites: só retoma falha de PASSO (não se o processo foi morto no meio de um passo: aí o estado não chega a ser gravado); passo que falhou refaz do começo dele; o estado guarda o texto dos resultados em disco (pasta do usuário, sem segredos extras além do que os passos produziram). Não testado: modelo real, Termux real.

## 0.19.0 — workflows com condição (when/unless) e validação (agent check)

- **`when` / `unless` por passo:** o passo só roda se a condição for verdadeira (`unless` = só se for falsa). Passo pulado NÃO gasta chamada de IA, deixa `{{id}}` vazio e o resumo marca `(pulado)`. Duas formas: texto (`"when": "{{achados}}"` é falso se vazio, `false`, `não`, `0` ou `[falhou:...]`, então um passo opcional que falhou também pula quem dependia dele) e objeto (`{"var":"achados","contains":"bug"}`, `{"var":"modo","equals":"rapido"}`, `{"var":"x","empty":true}`; sem diferenciar maiúsculas). Combina com `{{var|padrão}}`: `{{correcao|nenhum, estava limpo}}`.
- **Resultado final** passa a ser o último passo QUE RODOU; se nenhum rodou, o agente recebe a explicação.
- **`gemini-code agent check <arquivo ou nome>` e `/workflows validar <nome>`:** confere o workflow sem rodar nada e sem gastar IA, listando TODOS os problemas de uma vez. Erros: `id` repetido ou inválido, passo sem `prompt`, `retry`/`tools`/`when` inválidos, mais de 10 passos, passo usando resultado de passo futuro. Avisos: sem `description` (o agente escolhe pela descrição), campo com erro de digitação (`retries`, sugere `retry`), ferramenta que não existe, último passo condicional, variáveis obrigatórias. Código de saída 1 se houver erro (serve em script/CI).
- **Exemplo novo:** `workflows/exemplos/revisar-e-corrigir.json` (só propõe o patch se a revisão achar bug; senão só confirma). Agora são 4 exemplos, todos validados por teste.
- 9 testes novos (`tests/workflowsV019.test.js`). Total: 370, todos passando.
- Limites: a condição olha texto (`contains` é heurística: depende de o prompt do passo anterior pedir uma resposta fácil de checar, como "responda apenas: sem bugs"); ainda sem loop, paralelo ou aninhamento. Não testado: modelo real, Termux real.

## 0.18.0 — workflows à prova de erro (variáveis, retry, passo opcional, tools por passo)

- **Variáveis conferidas ANTES de gastar IA:** `run_workflow` agora lê os `{{...}}` do arquivo. Variável sem valor e sem padrão (`{{alvo}}`) vira erro claro dizendo o que passar em `vars` (antes sumia em silêncio e o prompt saía furado). Passo que usa `{{resultado}}` de um passo que só roda DEPOIS é recusado ("mal montado"). A lista de workflows mostra `[vars obrigatórias: ...] [opcionais: ...]`, então o agente já sabe o que pedir.
- **Valor padrão:** `{{linhas|6}}` usa 6 quando a variável não vem (ou vem vazia). Vale no `agent run` também.
- **Por passo:** `"retry": 0-2` (tenta de novo se a chamada falhar; erro final cita as tentativas), `"optional": true` (se falhar, o passo vira `[falhou: motivo]` para os próximos e o workflow continua; o resumo avisa), `"model"` (modelo só daquele passo, ex. `@local` para gastar zero cota) e `"tools"` (lista de ferramentas do passo; `[]` = passo sem ferramentas, bom para resumir sem risco). `tools` só RESTRINGE: é a interseção com as ferramentas de quem chamou, e `run_workflow` nunca entra.
- **`/workflows rodar <nome> var=valor ...`:** roda direto, sem o modelo escolher (`"var=valor com espaço"` entre aspas). `/workflows` mostra o que cada um precisa.
- **Erro no meio:** a mensagem diz qual passo falhou e quais já tinham rodado.
- **Novo exemplo:** `workflows/exemplos/diagnosticar-e-resumir.json` (checagens como passo opcional com retry + resumo sem ferramentas).
- **Correção de segurança:** na camada de ferramentas, lista vazia significa "todas liberadas". Um passo com `tools: []`, uma interseção vazia, ou um pai que só tinha `run_workflow` poderiam virar acesso a TODAS as ferramentas. Agora "nenhuma" é um marcador próprio e tem teste.
- **Correção do `/rewind`:** o id do turno era `t_<ms>_<aleatório>` e ordenado por nome; dois turnos no mesmo milissegundo saíam na ordem errada de vez em quando (o teste "/rewind N volta vários turnos" falhava ~1 em 3 rodadas). Carimbo agora sempre cresce.
- 14 testes novos (`tests/workflowsV018.test.js` + 1 no `rewind`); 3 testes antigos de workflow ajustados ao novo comportamento (vars obrigatórias, mensagem de erro do passo). Total: 361, todos passando.
- Limites: workflows continuam só na pasta global, máx. 10 passos, sem aninhamento, sem condição/loop/paralelo; `retry` só repete erro de chamada, não resposta ruim. Não testado: modelo real escolhendo/preenchendo `vars`, Termux real.

## 0.17.0 — o agente aciona workflows sozinho (run_workflow)

- **`run_workflow`:** nova ferramenta. Sem argumentos lista os workflows salvos em `~/.gemini-code/workflows/*.json` (nome, nº de passos, descrição); com `name` (e `vars` opcional, que preenche `{{variavel}}` nos prompts) roda os passos em ordem, cada um alimentando o próximo por `{{id_do_passo}}`, e devolve o resultado final mais um resumo dos passos. Os mesmos arquivos de `gemini-code agent run` servem, sem mudar nada.
- **O agente sabe que existem:** se houver workflows, o prompt do sistema ganha UMA linha com os nomes (sem workflows, nada é adicionado: custo zero). Ele lista as descrições e escolhe quando o pedido combina.
- **Travas:** só a pasta GLOBAL (um repositório baixado não injeta workflows); nome só `[a-z0-9_-]` (sem `../`); no máximo 10 passos; um workflow não chama outro; os passos herdam as ferramentas liberadas de quem chamou (perfil explore/plan nunca ganha `run_workflow`). Hooks, `/passo` e o limite de tokens valem dentro dos passos. Erro vira texto, não derruba o agente.
- `/workflows` lista no chat. Exemplo novo: `workflows/exemplos/revisar-e-resumir.json` (revisão só de leitura com `{{alvo}}`).
- 5 testes novos (`tests/workflowTools.test.js`).
- Limite: o agente decide pela descrição; vale caprichar no campo `description` do workflow. Cada passo é uma chamada de IA, então um workflow de N passos custa N chamadas.

## 0.16.0 — aprovação passo a passo (/passo)

- **`/passo [on|off]`:** com o modo ligado, antes de CADA `write_file`/`edit_file` o chat mostra uma prévia e pergunta `s/n/t`. Arquivo novo mostra o número de linhas; sobrescrita mostra `antes → depois`; edição mostra o trecho `-` e `+` (cortado em 12 linhas). `s` grava, `n` recusa e o modelo recebe "Recusado pelo usuário… pergunte o que ele prefere", `t` grava e desliga o modo.
- **Seguro por padrão:** resposta vazia, estranha, erro ao perguntar ou stdin fechado = RECUSA. Nunca grava por engano. `run_shell` continua com a confirmação própria (não é perguntado duas vezes). `run` e rotinas nunca perguntam.
- **Ordem:** hooks `PreToolUse` rodam primeiro; só o que passar por eles chega à pergunta. Vale também para as gravações dos subagentes. Combina com `/plano` (aprova o plano inteiro) e `/rewind` (desfaz depois).
- `confirmarEscrita: true` na config já abre o chat com o `/passo` ligado.
- 5 testes novos (`tests/stepApproval.test.js`), incluindo o loop real do agente.
- Limite: a prévia mostra o início do conteúdo, não um diff linha a linha de arquivos grandes.

## 0.15.0 — custo de IA sob controle (/custo, limite e compactação automática)

- **`/custo`:** mostra, desta sessão, as chamadas ao Gemini e os tokens REAIS que a API informa (`usageMetadata`: entrada, saída incluindo pensamento, por modelo), as chamadas locais (Ollama/code-ia, que não gastam cota) e o tamanho do contexto da última chamada. `/custo zerar` recomeça. Funciona com e sem streaming. Não mostra preço de propósito (tabelas mudam; tokens são o dado confiável).
- **`maxTokensSessao` (config, padrão 0 = sem limite):** teto de tokens do Gemini por sessão. Avisa uma vez ao passar de 80% e, ao estourar, recusa a próxima chamada de nuvem com mensagem clara (`/compact`, `/local`, `/codeia`, `/custo zerar` ou aumentar o limite). Modelo local nunca é bloqueado.
- **`autoCompactTokens` (config, padrão 60000; 0 desliga):** no chat, se o contexto da última chamada passou desse valor, roda o `/compact` sozinho antes do próximo turno (resumo local, sem chamar modelo). Cada chamada seguinte manda menos tokens.
- 7 testes novos (`tests/usage.test.js`), incluindo streaming SSE e o roteador bloqueando a nuvem mas não o local.
- Limites: a contagem é só do processo atual (não persiste); só conta o chat/agente (não `generateText` do design/mídia); Ollama não informa tokens, então só conta chamadas.

## 0.14.0 — modo plano com aprovação (/plano e /aprovar)

- **`/plano [pedido]`:** o agente só LÊ e planeja; nada é gravado nem executado. A trava é uma allowlist real (`read_file`, `list_dir`, `search_files`, `read_skill` + `todo_write`, que só guarda a lista em memória), não só um pedido no prompt: se o modelo insistir em `write_file`/`run_shell`, a execução é recusada. O plano termina numerado, com arquivos que serão tocados e como será verificado. O prompt do chat vira `você [plano]>`.
- **`/aprovar [ajuste]`:** sai do modo plano e manda o agente executar o plano que está na conversa (com seu ajuste, se houver). Sem plano pendente, só avisa. `/plano off` (ou `sair`/`cancelar`) cancela sem executar nada.
- Combina com o resto: o turno executado ganha `/rewind` e foto do `/snapshots`, e os hooks continuam valendo. `plano` e `aprovar` entraram nos nomes reservados.
- 4 testes novos (`tests/planMode.test.js`), incluindo o loop real com o modelo insistindo em gravar.
- Limite: a aprovação é do plano inteiro, não passo a passo; a confirmação s/n do `run_shell` continua valendo na execução.

## 0.13.0 — hooks (comandos seus antes/depois das ferramentas)

- **`src/hooks.js`:** `~/.gemini-code/hooks.json` registra comandos que rodam em `PreToolUse` (antes) e `PostToolUse` (depois) de cada ferramenta, inclusive nas dos subagentes. Sem custo de IA.
- **Formato:** `{ "PreToolUse": [{ "matcher": "run_shell", "command": "meu-filtro.sh", "timeout": 10 }], "PostToolUse": [{ "matcher": "edit_file|write_file", "command": "npm run lint --silent" }] }`. O `matcher` é regex e precisa casar com o nome INTEIRO da ferramenta (`*` ou vazio = todas). O comando roda com `sh -c`, recebe `{event, tool, args, cwd, resultado}` em JSON no stdin e as variáveis `GEMINI_CODE_EVENT` e `GEMINI_CODE_TOOL`. Timeout em segundos (padrão 10, máx. 60).
- **Código de saída 2:** em `PreToolUse` BLOQUEIA a ferramenta e o texto da saída vai ao modelo como motivo ("Bloqueado por hook do usuário: …"). Em `PostToolUse` anexa a saída ao resultado (bom para erros de lint). Qualquer outro código ≠ 0 só mostra um aviso amarelo.
- **Segurança:** só o arquivo GLOBAL é lido. Um repositório baixado não consegue registrar comandos que rodam na sua máquina sozinho. Hook com erro, inexistente, com regex inválido ou que estoura o tempo nunca derruba o agente nem bloqueia. Hook que sai sem ler o stdin (EPIPE) conta pelo código de saída.
- `/hooks` lista os hooks ativos. 7 testes novos (`tests/hooks.test.js`), incluindo o loop real do agente.
- Limite: um hook só vê o nome e os argumentos da ferramenta; não edita os argumentos.

## 0.12.1 — git automático (fotos do projeto a cada turno)

- **`src/snapshots.js`:** dentro de um repositório git, o chat tira uma foto do projeto antes e depois de cada turno, numa referência escondida (`refs/gemini-code/snapshots`). Não mexe na sua branch, no índice nem no stash, não precisa de `user.name`/`email` e nunca faz `git init`. Nada mudou = nenhuma foto nova. Custo de IA: zero.
- **Complementa o `/rewind`:** a foto também pega o que `run_shell` mudou (rm, mv, npm install…). `/snapshots` lista; `/snapshots restaurar N` volta os arquivos à foto N (1 = a mais nova). Antes de restaurar, o estado atual vira uma foto, então a restauração é reversível. Arquivos criados depois da foto não são apagados.
- **Segredos fora da foto:** `.env*`, `*.pem`, `*.key`, `*.p12`, `id_rsa*`, `credentials.json` e `node_modules`.
- Ligado por padrão; desligue com `autoGit: false` na config. 4 testes novos (`tests/snapshots.test.js`).
- Limite: arquivos grandes versionados entram na foto e ocupam espaço em `.git`.

## 0.12.0 — /rewind: desfazer por turno

- **Diário automático por turno (`src/rewind.js`):** no chat, antes de `write_file`/`edit_file` mexerem num arquivo, o conteúdo anterior é guardado (ou o fato de ele não existir). Só o estado de ANTES do primeiro toque no turno. Fica em `~/.gemini-code/rewind/`, últimos 20 turnos, arquivo de até 2 MB. Custo de IA: zero.
- **`/rewind [N]`:** volta o último turno que gravou arquivos (ou os N últimos); arquivo criado no turno é removido. `/rewind lista` mostra os turnos do projeto atual; turnos de outras pastas não são tocados.
- **Trava de segurança:** se o arquivo mudou depois do que o agente gravou (você editou, ou um comando de shell mexeu), ele é pulado e listado; `--force` sobrescreve. Arquivo grande demais para guardar é avisado, não apagado em silêncio.
- Depois de cada turno que gravou arquivos, o chat avisa quantos foram e que `/rewind` desfaz. `rewind` entrou na lista de nomes reservados dos comandos seus.
- 6 testes novos (`tests/rewind.test.js`).
- Limite: não rastreia o que `run_shell` faz (rm, mv, npm install…), e não usa git.

## 0.11.0 — funções de agente inspiradas em Claude Code, Codex e similares

Inspiradas em padrões públicos desses agentes (lista de tarefas, compactação de contexto, comandos de barra seus). Não copia código de nenhum deles.

- **`todo_write` (lista de tarefas do agente):** em trabalho com 3+ passos o modelo escreve o plano como checklist e marca uma tarefa `in_progress` por vez; lista inválida (duas em andamento, status errado, vazia) é recusada e a anterior continua. `/tarefas` mostra a lista no chat. O prompt do agente orienta a usar só em tarefa com vários passos. Fica só na memória do processo.
- **`/compact`:** troca o começo da conversa por um resumo feito localmente (sem chamar modelo, sem custo): pedidos, ferramentas usadas, arquivos tocados e a última resposta. Mantém as últimas mensagens inteiras e nunca separa chamada de ferramenta da resposta (a API do Gemini recusa isso). Salva a sessão.
- **Comandos de barra seus:** um `.md` em `.gemini-code/commands/` (projeto) ou `~/.gemini-code/commands/` vira `/nome`. Aceita `$ARGUMENTS`, `$1..$9` e `description:` opcional. Projeto vence global; nomes embutidos (`/help`, `/clear`…) nunca são substituídos; arquivo > 20 KB é ignorado. `/commands` lista.
- 5 testes novos (`tests/agentePadroes.test.js`) e verificação no chat real de `/tarefas`, `/commands`, `/compact` e de um comando seu.

## 0.10.0 — mais conteúdo para bots e Termux, e gerenciar o que você ensinou

- **Corpus 116 → 126 blocos:** placar/partidas de bot no SQLite (better-sqlite3), webhook do Mercado Pago, canal privado por partida, dar/tirar cargo, embed e menu de seleção no discord.js, instalar pacotes que compilam no Termux, atualizar o Termux, túnel com cloudflared, bateria/espaço e evitar que o Termux feche sozinho.
- **Gerenciar o que você ensinou:** `/ensinados` lista, `/esquecer pergunta` apaga UMA coisa (no chat); na CLI, `code-ia notes` e `code-ia unteach "pergunta"`. Aceita um pedaço do título; se der mais de uma opção, pede a pergunta completa. `forget` continua apagando tudo.
- Avaliação: 67 → 76 perguntas (≥ 90% no 1º resultado; hoje 76/76). Pergunta ambígua "termux fecha sozinho" continua achando o bloco de erro de memória, que também é resposta válida e 1 teste novo.

## 0.9.0 — code-ia entende erro colado e conhece mais erros

- **Cole o erro inteiro:** stack trace do Node (`at ...`) ou `Traceback` do Python é reduzido às linhas que dizem o erro (sem caminhos nem linhas de pilha) antes da busca. Pergunta normal não é alterada.
- **8 erros comuns novos (corpus 108 → 116 blocos):** `Cannot read properties of undefined`, `ENOENT`, `EACCES`, `require is not defined` (ES module), `ModuleNotFoundError`, `IndentationError`, `fetch failed`/`ETIMEDOUT` e `git push rejected`.
- Avaliação: 59 → 67 perguntas (≥ 90% no 1º resultado) e 1 teste novo.

## 0.8.0 — code-ia edita arquivo existente (com trava)

- **Troca exata de trecho:** `troque "3000" por "8080" em server.js` (também `substitua`, `mude`, aspas simples ou crases) chama `edit_file`, com o backup de sempre. Só se `edit_file` estiver liberado no perfil/sessão.
- **Travas:** o arquivo precisa existir; fica restrito à pasta atual; recusa `.env`/segredos; se o trecho não existe, não muda nada; se aparece mais de uma vez, pede mais contexto em vez de adivinhar qual trocar.
- Novo teste em `tests/codeia-v070.test.js`.

## 0.7.0 — code-ia mais rápido, mais conversável e com mais conteúdo

- **Gerador de código bem mais rápido:** o `completar` deixou de varrer o corpus inteiro a cada token; agora usa um índice (token → posições) montado na hora e não gravado em disco. Mesma saída de antes (testado contra a varredura completa); em ~118 mil tokens de código, 5 completações caíram de ~177 ms para ~69 ms (já contando a montagem do índice). Quanto mais código você ensinar, maior o ganho.
- **"outra" no chat:** se a resposta não era a que você queria, diga `outra`, `próxima` ou `não era isso` e o code-ia mostra o 2º melhor resultado da mesma pergunta; pedir de novo avança para o 3º. Quando acabam as boas respostas, ele diz isso em vez de inventar.
- **"só o código" no chat:** `só o código`, `código` ou `mostra o código` devolve apenas os blocos de código da última resposta, sem título nem explicação.
- **Corpus maior (92 → 108 blocos):** Pix com Mercado Pago, `Promise.all`/`allSettled`, `unhandledRejection`, pm2, validação de POST e middleware de token no Express, Map/Set, desestruturação/spread, node-cron, Docker, SQL (JOIN/INSERT/UPDATE), f-string, CSV em Python, stream de câmera com Flask + OpenCV, jq e fetch com Authorization.
- **Correção de digitação mais segura:** em pergunta com 3+ palavras, o bloco só vale se casar com ao menos uma palavra exata (antes "receita" virava "rejeita" e achava resposta sem sentido). Pergunta curta, como `ffmepg`, continua sendo corrigida.
- A avaliação passou de 43 para 59 perguntas (exige ≥ 90% no 1º resultado) e há 8 testes novos em `tests/codeia-v070.test.js`.

## 0.6.0 — code-ia entende erro de digitação, cria arquivos e aprende no chat

- **Tolera erro de digitação:** "servido express", "arqivo", "ffmepg", "discorde" encontram a resposta certa (palavra que não existe no vocabulário vira a mais parecida, com troca de letras vizinhas contando como 1 erro). Palavra totalmente sem sentido continua sem resposta. A avaliação passou a ter 43 perguntas, 6 delas com erro de digitação (exige ≥ 90%).
- **Cria arquivos (com trava):** "crie server.js com servidor express", "crie um servidor express em app.js" e "salve isso em x.js" (salva o 1º código da última resposta) chamam `write_file`. Só arquivo NOVO: nunca sobrescreve um que já existe, nunca escreve fora da pasta atual, nunca `.env`/segredos, e só se `write_file` estiver liberado no perfil/sessão. Se não conhece código pro assunto, diz isso em vez de criar arquivo vazio ou inventado. Quem escreve é a ferramenta do agente (com o backup de sempre).
- **Ensinar na hora:** no chat, `/ensinar pergunta :: resposta`; na CLI, `code-ia teach "pergunta" "resposta"`. Mesma pergunta de novo substitui a resposta; `#` no meio do texto não quebra a estrutura; `forget` desfaz.
- **Início mais rápido e modelo menor:** o code-ia confere só nome/tamanho/data dos arquivos antes de decidir se precisa ler e refazer o modelo, e o código não é mais gravado em duplicidade no disco (modelo em disco passa para a versão 3; quem vinha da 0.5.x é atualizado sozinho). Com muito código ensinado, isso pesa bastante.
- 5 novos testes (digitação, criação segura de arquivo, loop do agente com `write_file`, `/ensinar`, início rápido).

## 0.5.0 — code-ia mais esperto

- **Busca melhor:** sinônimos e flexões PT/EN (criar/crie/create, arquivo/file, servidor/server…), camelCase separado e também inteiro (`readFileSync`, `JavaScript`) e bônus quando o título do bloco é "sobre" a pergunta. Novo `tests/codeia-eval.test.js` mede 37 perguntas reais (exige ≥ 90% de acerto no 1º resultado; corrigiu a quebra de "JavaScript" em "java"+"script").
- **Corpus embutido mais que dobrou (44 → 92 blocos):** SQLite, WebSocket, Express (estáticos, CORS), chaves/ambiente, retry/timeout, ESM, regex, datas, API do Gemini, Ollama, streaming, slash commands e botões do Discord, Three.js, toque/colisão em jogos, Minecraft Bedrock, overlay Android (Kotlin), ffmpeg, Termux:API, cron, git, e uma seção de **erros comuns** (EADDRINUSE, Cannot find module, ECONNREFUSED, 429, CORS…).
- **Completar código mais fiel:** o gerador agora usa contexto longo (até 12 tokens) em vez de tabela n-grama fixa; copia o que aprendeu, fecha a instrução e **para sem inventar** quando não reconhece o trecho (ou quando o contexto ficaria curto demais, evitando emendar dois trechos). Modelo menor em disco.
- **Aprende com o SEU código:** `code-ia learn pasta` aceita `.js .py .html .sh .css .json .kt .java .lua …`; vira blocos pesquisáveis ("onde está a função X?") com a fonte citada, e alimenta o gerador com o seu estilo. Ignora `node_modules`, `.git`, `.env*`, chaves/segredos, `package-lock`, `*.min.*` e arquivos > 200 KB. Novo `code-ia forget` apaga o que foi ensinado.
- **Ferramentas somente-leitura:** pedidos claros ("leia package.json", "liste a pasta src", "procure TODO em src") chamam `read_file`, `list_dir` e `search_files` — só se a ferramenta está liberada no perfil/sessão atual (convidado e perfis restritos continuam valendo). Nunca escreve, edita, apaga nem roda comando.
- **Conversa:** responde saudação, "quem é você" (não finge ser Qwen/DeepSeek/Gemini), "ajuda"; entende pergunta curta de acompanhamento ("e em python?"); quando não sabe, mostra o mais próximo que achou.
- Modelo em disco passa para a versão 2; quem vinha da 0.4.0 é atualizado sozinho, com aviso claro.

## 0.4.0 — code-ia: modelo próprio, instalado automaticamente

- Novo modelo **code-ia**, escrito do zero em JavaScript puro (`src/code-ia/`): nenhum Qwen, DeepSeek, Ollama ou outro modelo de terceiros por trás, nenhuma chamada de rede.
- Como funciona: memória de conhecimento com busca BM25 (corpus embutido + `~/.gemini-code/knowledge` + `skills` + o que você ensinar) e gerador de código n-grama (ordem 4, com backoff) treinado nesse corpus. É um modelo pequeno: responde o que aprendeu e melhora quando você ensina mais; não é um LLM generalista e não chama ferramentas.
- Instalação automática: na primeira execução (`chat`, `run`, `sub`, `agent`, `live`, `voice`, `ciencia` ou `gemini-code` sem argumentos) o modelo é construído no aparelho e salvo em `~/.gemini-code/code-ia/model.json`; nas seguintes só confere o hash do corpus e reconstrói sozinho se o conhecimento mudou. Arquivo corrompido é refeito.
- `gemini-code` sem argumentos: na 1ª vez instala o code-ia e já abre a conversa; com modelo instalado e API key, mostra a ajuda como antes.
- Sem API key do Gemini o agente passa a usar o code-ia em vez de falhar (`codeIaAuto`, padrão `true`; com `false` volta o erro "Nenhuma API key configurada").
- Novos comandos: `code-ia status|ask|complete|learn|reinstall`, `config set-provider code-ia`, `/codeia` no chat; `doctor` mostra se o code-ia está instalado.
- Ajusta dois testes de CLI ao novo comportamento e adiciona `tests/codeia.test.js`.

## 0.3.16 — Tratamento claro da cota Gemini (HTTP 429)

- Interpreta o `RetryInfo`, o cabeçalho HTTP `Retry-After` e o tempo sugerido no texto de erro do Google.
- Em `429 RESOURCE_EXHAUSTED`, mostra a espera indicada pela API e orienta a reenviar a mensagem manualmente, sem repetir automaticamente a chamada nem consumir mais cota.
- Exibe métrica, limite e modelo indicados na mensagem quando disponíveis; remove a dica enganosa que sugeria trocar para o mesmo modelo que já estava limitado.
- Mantém o provedor padrão como `gemini`; nenhuma chamada ao vivo foi feita durante os testes para respeitar a cota do usuário.
- Adiciona testes unitários para mensagens 429, parsing de `RetryInfo`, `Retry-After` e ausência de repetição automática.

## 0.3.15 — Corrige testes offline e verificação sintática

- Removeu a dependência obrigatória de `chalk` usando um adaptador de cores local compatível com TTY e `NO_COLOR`.
- Tornou o carregamento de `ws` tardio, permitindo importar e testar a lógica Cowork sem inicializar o transporte de rede; chamadas reais sem a dependência agora mostram uma mensagem clara.
- Corrigiu o comando `npm run lint`: usa ESLint se estiver instalado e, caso contrário, executa verificação sintática de todos os arquivos JavaScript, avisando que as regras de estilo não foram verificadas.
- Tornou possível executar os testes de unidade no ambiente offline atual sem instalar dependências; o transporte WebSocket real ainda precisa de `ws` instalado.
- Permitiu passar `cwd` explicitamente para `buildSystemInstruction`, isolando testes e permitindo construir instruções para diretórios de projeto escolhidos.
- Corrigiu um teste de conhecimento que lia arquivos de contexto do repositório em vez do diretório temporário vazio do teste.

# Changelog

## 0.3.14 — Profiles, Kimi Code patterns, and Higgsfield readiness

- Added real tool-allowlisted `coder`, `explore`, `plan`, `review`, and `test` profiles for `gemini-code run`.
- Added `profiles list/show` and kept `--read-only` as a backwards-compatible alias for `explore`.
- Added bounded, isolated subagent aliases aligned with Kimi's `explore`, `plan`, `reviewer`, and `coder` roles.
- Expanded project context discovery with `KIMI.md`, `KIMI_CODE.md`, and `SYSTEM.md`.
- Added local `kimi`, `kimi-code`, and `higgsfield` executable detection to `doctor`.
- Added an optional Higgsfield CLI + Skills guide with explicit authorization, authentication, and credit-spend safeguards; no external install/login/generation is performed automatically.
- Added a reusable Kimi-style multi-agent workflow Skill.
- Updated interoperability docs and added profile permission tests.

### Verification limitations for this build

The eight previous v0.3.13 tests and the new profile/subagent tests are run separately where possible. Full-suite status remains dependent on installing `chalk` and `ws`; the npm registry was not reachable (`EAI_AGAIN`) during this build. Syntax checks do not require those packages. See the delivery report for verified commands.

## 0.3.13 — Agent workflow upgrades

- Added persistent sessions with active-session selection and automatic chat history saving.
- Added bounded workspace checkpoints with SHA-256 manifests, secret-file exclusions, explicit restore confirmation, pre-validation and an automatic safety checkpoint before restore.
- Added local execution artifacts with SHA-256 integrity verification and CLI inspection commands.
- Added a read-only `run` profile and optional pre-run checkpoint.
- Added a heuristic secret-pattern scanner that reports file, line and category without printing detected values.
- Expanded project context discovery to common instruction filenames used across coding agents.
- Added a `doctor` command for local CLI detection, a reusable engineering Skill, interoperability documentation and a GitHub Actions CI workflow.
- Added tests for persistence, checkpoint safety, artifact integrity, context discovery and secret scanning.

### Verification limitations for this build

The eight tests added for v0.3.13 pass. The complete suite reports 163/184 passing in the current build environment; 21 test files/CLI cases are blocked because the environment has no installed `chalk` and `ws` dependencies. `npm ci` could not reach `registry.npmjs.org` because DNS returned `EAI_AGAIN`. JavaScript syntax checks and the repository's own secret-pattern self-scan pass. See the delivery report for exact details.
