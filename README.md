# gemini-code

## Limite de uso da API Gemini (HTTP 429)

Se a API responder `429 RESOURCE_EXHAUSTED`, a aplicação não troca automaticamente de provedor nem repete a chamada quando você selecionou explicitamente o provedor `gemini`. Se o Google informar um tempo como `Please retry in 52s`, aguarde esse período e envie a mensagem novamente. Quando a resposta não indicar espera, confira a métrica, o limite e o projeto em [AI Studio](https://aistudio.google.com/) e a [documentação de limites](https://ai.google.dev/gemini-api/docs/rate-limits). Um limite `0` significa que a métrica daquela operação não permite chamadas no projeto atual; trocar para o mesmo modelo não resolve. Para usar apenas a API Gemini, confirme com `gemini-code config set-provider gemini`. **Opcional (v0.30.0):** `gemini-code config set-wait-quota 60` faz o programa esperar sozinho (até 60 s) quando o Google pedir um tempo curto e repetir uma vez; vem desligado.

Um agente de terminal no espírito do **Claude Code** / **Codex**, só que usando a
**API do Gemini** do Google — feito para rodar no **Termux** (Android) ou em
qualquer PC/Linux com Node.js.

## MinhaIA Android integrada (primeira versão)

O projeto agora inclui o aplicativo nativo **MinhaIA** em `mobile/MinhaIA/`, com Kotlin, Jetpack Compose, histórico e memórias locais e um motor Android baseado em `llama.cpp`. É um subprojeto Android separado do agente de terminal: ele não exige API Gemini para o chat local.

Para configurar o Gemini Code para usar o mesmo modelo Qwen3-1.7B Q4_K_M, com download validado por SHA-256 e compartilhado em Downloads com o app Android, rode no Termux:

```bash
bash android/install-minhaia-model.sh
node bin/gemini-code.js chat
```

O script pede que `termux-setup-storage` já tenha sido executado e usa o armazenamento compartilhado `Download`. Para usar o arquivo no app Android, compile/instale `mobile/MinhaIA` e escolha **Modelo → Importar outro GGUF**; por segurança, o app copia o modelo para o armazenamento privado, então é necessário espaço adicional.

O modelo GGUF é o mesmo, mas os históricos e as memórias do CLI e do app ainda são independentes. A integração não compila o APK automaticamente nem afirma funcionamento no Galaxy A55 sem build e teste no aparelho. Veja `docs/MINHAIA_INTEGRACAO.md`.

## O que tem aqui

- **Agente de terminal** (`gemini-code chat` / `gemini-code run`): conversa,
  lê e escreve arquivos, roda comandos de shell (com confirmação), e usa
  ferramentas MCP conectadas — igual ao fluxo do Claude Code.
- **Gemini Design** (`gemini-code design ...`): gera slides (HTML navegável +
  Markdown), documentos e imagens.
- **Mídia** (`gemini-code media ...`): estrutura pronta para gerar vídeo
  (Veo), música e som (Lyria) — esses modelos exigem acesso liberado na sua
  conta do Google AI Studio/Vertex, então o comando avisa claramente quando
  isso não estiver disponível em vez de travar.
- **Voz e câmera** (`gemini-code voice ...`): usa o app **Termux:API** para
  falar, ouvir o microfone e tirar fotos, e manda isso pro agente.
- **Skills** (pasta `skills/`, formato `SKILL.md`): boas práticas reutilizáveis
  que o agente consulta quando relevante.
- **Agentes e workflows** (`agents/`, `workflows/`, comando `agent run`):
  personas prontas e automações de vários passos encadeados.
- **MCP** (`mcp.example.json`): conecte qualquer servidor MCP (arquivos,
  busca na web, bancos de dados, etc.) e o agente ganha essas ferramentas
  automaticamente.
- **Gemini Cowork** (`gemini-code cowork ...`): o celular conecta no PC
  **na mesma rede local** e manda tarefas para o agente rodar direto no PC
  (arquivos, comandos, tudo), com autenticação por token.

## Modo solo (v0.39.0) — o code-ia sozinho, sem nenhuma outra IA

```bash
gemini-code solo on      # só o code-ia responde; Gemini, llama.cpp e Ollama ficam bloqueados
gemini-code solo status
gemini-code solo off     # volta ao provedor de antes
```

Três travas: o roteador escolhe sempre o code-ia, os comandos que dependem de outra IA (`design`, `media`, `live`, `models`, `ollama`) são recusados e a rede para serviços de IA é bloqueada. Lembre: o code-ia é busca no que ele aprendeu + gerador por contexto, não um LLM; ensine-o com `code-ia learn` e `/ensinar`.

## code-ia — modo leve de conhecimento (v0.4)

A **code-ia** é uma ferramenta local pequena que combina busca no material conhecido com um gerador de código n-grama. Ela é útil para procurar conteúdo que você ensinou e para exemplos específicos, mas **não é um modelo de linguagem geral** e não consegue responder bem a qualquer assunto. Ela fica disponível como opção, não como IA principal.

A conversa principal usa **llama.cpp + um modelo GGUF local**, sem exigir Ollama. Depois de baixar o modelo uma vez, as perguntas podem funcionar offline. No modo híbrido, se você configurar uma chave Gemini, pedidos complexos podem usar a internet e o aplicativo tenta alternar entre nuvem e modelo local quando houver falhas recuperáveis. Para Android, siga `ANDROID_TERMUX.md`. **(v0.37.0)** O modelo local sobe sozinho em segundo plano (`gemini-code llamacpp start|stop|status|log`, ou `config set-llamacpp-autostart on`), cabe no contexto do celular (4096 tokens por padrão, com ferramentas compactadas e histórico podado), mostra a resposta enquanto escreve e não pendura se o servidor travar.

```bash
gemini-code code-ia ask "como criar servidor com express"
gemini-code code-ia complete "const fs = require("
gemini-code code-ia learn meu-conhecimento.md   # cada "# título" vira um bloco pesquisável
gemini-code code-ia status
gemini-code config set-provider code-ia  # escolher o modo limitado de conhecimento
# no chat: /local usa o LLM geral local; /codeia força a code-ia pequena; /cloud usa Gemini
```

**No dia a dia (v0.5):**
```bash
gemini-code run "leia package.json"           # lê o arquivo com a ferramenta read_file
gemini-code run "liste a pasta src"           # list_dir
gemini-code run "procure TODO em src"         # search_files
gemini-code code-ia learn ~/meu-projeto       # aprende SEU código (.js .py .html .sh …; ignora .env e node_modules)
gemini-code run "onde está a função calcularDano"   # acha no seu código e cita a fonte
gemini-code code-ia forget                    # esquece o que você ensinou
gemini-code run "crie server.js com servidor express"   # cria arquivo NOVO (nunca sobrescreve)
gemini-code code-ia teach "como chamar o dono" "use !dono"   # no chat: /ensinar como chamar o dono :: use !dono
```

**No chat (v0.7):** se a resposta não era a que você queria, diga `outra` (ou `próxima`, `não era isso`) para ver o próximo melhor resultado; `só o código` mostra apenas os blocos de código da última resposta.

**Editar (v0.8):** `troque "3000" por "8080" em server.js` troca um trecho exato e único num arquivo que já existe (com backup). Se o trecho não existe ou aparece mais de uma vez, ele não muda nada.

**Erro colado (v0.9):** cole o stack trace do Node ou o Traceback do Python no chat; o code-ia pega só a linha do erro e mostra a explicação e a correção se conhecer (ENOENT, `Cannot read properties of undefined`, `ModuleNotFoundError`…).

**Gerenciar o que você ensinou (v0.10):** no chat, `/ensinados` lista e `/esquecer pergunta` apaga uma coisa só; na CLI, `gemini-code code-ia notes` e `gemini-code code-ia unteach "pergunta"`.

## Funções de agente (v0.11)

- **Lista de tarefas:** o agente usa `todo_write` em trabalho com vários passos; veja com `/tarefas`.
- **`/compact`:** resume a conversa antiga sem custo e mantém as últimas mensagens inteiras.
- **Workflows automáticos (`run_workflow`):** use `/workflows exemplos` e `/workflows instalar <nome>` (ou copie um `.json` de `workflows/exemplos/` para `~/.gemini-code/workflows/`) e o agente passa a poder acioná-lo sozinho; `/workflows criar <nome> <pedido>` faz a IA escrever um rascunho (fora de uso até você rodar `/workflows aprovar <nome>`; avisa passos que gravam ou rodam comando), `/workflows novo <nome>` cria um esqueleto e `/workflows ver <nome>` resume um workflow quando o pedido combinar com a `description`. `/workflows` lista (com as variáveis que cada um pede) e `/workflows rodar <nome> var=valor` roda direto. Nos passos: `{{var|padrão}}`, `retry` (0-2), `optional`, `model`, `tools` (`[]` = sem ferramentas) e `when`/`unless` (passo condicional). `gemini-code agent check <arquivo>` (ou `/workflows validar <nome>`) confere o workflow sem rodar. Se um passo falhar, `/workflows retomar <nome>` continua dali sem refazer (nem pagar) os passos que já deram certo. `/workflows historico [nome]` mostra as últimas execuções (resultado, passos, tokens, duração; sem guardar saídas; inclui as feitas por `agent run`, marcadas `(terminal)`) (`--erros` filtra só as que falharam), `/workflows limpar historico|<nome>` apaga o histórico ou descarta uma execução interrompida, e `/workflows resumo [nome]` mostra % de sucesso, média de tokens/tempo e o passo que mais falha. `"each": "{{lista}}"` repete um passo para cada linha de uma lista (máx. 10), com `{{item}}` (se parar no meio, a retomada continua do item que parou); com `"paralelo": 2` ou `3` (só com ferramentas de leitura) vários itens rodam ao mesmo tempo. `"maxTokens"` no workflow põe um teto de gasto do Gemini por execução (para antes do passo que estouraria e deixa retomar depois). Exemplos: `revisar-e-resumir`, `diagnosticar-e-resumir`, `revisar-e-corrigir`, `revisar-cada-arquivo`.
- **`/passo`:** aprovação passo a passo — prévia e `s/n/t` antes de cada gravação de arquivo (`confirmarEscrita: true` liga ao abrir o chat). Na dúvida, recusa.
- **`/custo`:** tokens reais gastos na sessão. `maxTokensSessao` na config põe um teto; `autoCompactTokens` (60000) compacta o contexto sozinho, sem custo.
- **`/plano` e `/aprovar`:** modo plano — o agente só lê e planeja (trava real por allowlist) até você aprovar. `/plano off` cancela.
- **Hooks (`~/.gemini-code/hooks.json`):** comandos seus antes/depois das ferramentas; código de saída 2 em `PreToolUse` bloqueia (ex.: barrar `rm -rf`), em `PostToolUse` devolve a saída ao modelo (ex.: lint). Só o arquivo global vale. `/hooks` lista. Formato no CHANGELOG 0.13.0.
- **`/snapshots`:** em repositório git, fotos automáticas a cada turno numa referência escondida (não toca sua branch); `/snapshots restaurar N` volta. Pega também o que o shell mudou. Desligue com `autoGit: false`.
- **`/rewind`:** desfaz o que o agente gravou no último turno (como Ctrl+Z). `/rewind 3` volta 3 turnos, `/rewind lista` mostra os turnos, `--force` sobrescreve o que você mudou depois. Sem custo de IA e sem precisar de git; só cobre `write_file`/`edit_file`, não comandos de shell.
- **Comandos seus:** crie `.gemini-code/commands/revisar.md` com, por exemplo, `Revise o arquivo $1 procurando bugs`, e use `/revisar src/app.js`. `/commands` lista.

**Limites honestos:** esse modo continua limitado ao material encontrado e ao código que conhece. Para perguntas abertas de cultura geral, explicações, escrita, planejamento e outros assuntos, use o LLM via `llama.cpp` (ou a nuvem Gemini configurada) em vez de selecionar `code-ia`.

## Modelo local Android (llama.cpp), modo híbrido e conhecimento fixo

O modo padrão é `hybrid`: usa o modelo local via `llama.cpp`; quando uma chave Gemini estiver configurada, pedidos mais complexos podem ir para a nuvem. Sem internet, o modo local continua disponível desde que o modelo GGUF já tenha sido baixado e o servidor local esteja rodando. **Não é necessário instalar Ollama.**

No Android, veja o passo a passo pronto em [`ANDROID_TERMUX.md`](ANDROID_TERMUX.md). O script prepara o Termux, compila `llama.cpp`, baixa um modelo compacto (cerca de 1 GB) e mantém uma configuração de exemplo para treinar o conhecimento próprio.

Comandos gerais:

```bash
# Dentro da pasta gemini-code
npm install
node bin/gemini-code.js config set-provider hybrid
node bin/gemini-code.js llamacpp status
node bin/gemini-code.js chat
```

Para usar somente o modelo local: `gemini-code config set-provider llamacpp`. Para usar a nuvem (requer uma chave Gemini configurada): `gemini-code config set-provider gemini` ou digite `/cloud` no chat. Para modelo híbrido com acesso à nuvem, configure a chave com `gemini-code config set-key SUA_CHAVE` e mantenha `hybrid`.

### Como ensinar seu conhecimento

- Edite `android/MEUS_CONHECIMENTOS.md` com as regras, fatos e exemplos que quer usar.
- Carregue esse arquivo como conhecimento do agente: `node bin/gemini-code.js knowledge add android/MEUS_CONHECIMENTOS.md`.
- O conteúdo vira contexto fornecido ao modelo. Isso é **memória/conhecimento por prompt**, não treinamento dos pesos do modelo. A opção `code-ia learn` ensina a base pequena do `code-ia`, que continua menos capaz para perguntas gerais. Treinamento real do modelo (LoRA/fine-tuning) é um processo separado e não é feito automaticamente no celular.

## Instalação (Termux)

```bash
unzip gemini-code.zip
cd gemini-code
bash install.sh
gemini-code config set-key SUA_CHAVE_DO_GEMINI
```

Pegue sua chave grátis em <https://aistudio.google.com/apikey>.

## Instalação (PC / Linux / Mac)

> **Modo offline de desenvolvimento:** as verificações unitárias e a verificação sintática podem rodar sem dependências instaladas. O transporte Cowork por WebSocket requer a dependência `ws`; execute `npm install` enquanto houver conexão. `npm run lint` usa ESLint se estiver instalado e, caso contrário, realiza somente a validação sintática e informa essa limitação.

```bash
cd gemini-code
npm install
npm link      # deixa o comando "gemini-code" disponível globalmente
gemini-code config set-key SUA_CHAVE_DO_GEMINI
```

## Exemplos rápidos

```bash
# Conversa livre com o agente
gemini-code chat

# Uma instrução só
gemini-code run "crie um script python que renomeia fotos por data"

# Gerar uma apresentação
gemini-code design slides "os 3 primeiros passos para abrir uma loja digital"

# Rodar um workflow de vários passos
gemini-code agent run workflows/exemplos/design-e-publicar.json

# Abrir chat com uma persona pronta (modelo, instrução e ferramentas já configurados)
gemini-code agent run agents/exemplos/revisor-de-codigo.json

# Ver as skills instaladas
gemini-code skills list
```

### Subagentes

O agente pode delegar trabalho pesado a um subagente com contexto próprio (ferramenta
`delegate_task`) e receber só o relatório final — bom para investigar o projeto inteiro
sem encher a conversa. Tipos: `explorador` e `revisor` (só leitura) e `executor` (edita
e roda comandos). Dois ou três de leitura na mesma resposta rodam em paralelo.

```bash
gemini-code sub "onde é feita a autenticação e como funciona?"
gemini-code sub "revise src/security.js" --tipo revisor
gemini-code sub "adicione testes para src/agenda.js" --tipo executor
```

Subagente nunca passa das ferramentas do agente que o chamou e não cria outro subagente.

### Conhecimento do Neto (`knowledge/`)

`knowledge/GEMINI.md` (você e o ambiente) e `knowledge/AGENTS.md` (como o agente
trabalha) são copiados para `~/.gemini-code/knowledge/` pelo `install.sh`.
Edite as cópias de lá à vontade — o instalador nunca sobrescreve. Veja o que
está carregado com `gemini-code knowledge list`.

### Backups automáticos (desfazer edições do agente)

Toda vez que o agente sobrescreve ou edita um arquivo que já existia, o conteúdo
anterior é guardado em `~/.gemini-code/backups` (até 20 por arquivo).

```bash
gemini-code backups src/app.js              # lista (1 = o mais recente)
gemini-code backups restore src/app.js      # restaura o backup 1
gemini-code backups restore src/app.js 3    # restaura o backup 3
```

Restaurar também guarda o conteúdo atual como backup, então dá pra desfazer o desfazer.

### Gemini Cowork (celular + PC na mesma rede)

No **PC**:

```bash
gemini-code cowork server
```

Isso mostra o IP do PC e um token. No **celular** (Termux), na mesma rede
Wi-Fi:

```bash
gemini-code cowork connect 192.168.0.10 --token TOKEN_MOSTRADO_NO_PC
```

Agora tudo que você digitar no celular roda como uma tarefa completa do
agente **no PC** (arquivos, comandos, tudo o que o PC tiver acesso).

### Voz

```bash
pkg install termux-api   # se ainda não tiver
gemini-code voice listen   # ouve o microfone, manda pro agente e fala a resposta
gemini-code voice say "oi, tudo certo"
```

### Live (conversa contínua por voz, tipo uma ligação)

```bash
gemini-code live
```

Fica num loop: ouve você falar, manda pro agente, fala a resposta em voz alta,
e volta a ouvir — sem precisar digitar nada nem rodar o comando de novo a
cada frase. Para encerrar, diga **"parar"**, **"sair"** ou **"tchau"** (ou
Ctrl+C).

Use `gemini-code live --sem-voz` para testar só em texto (sem falar/ouvir),
útil se o Termux:API ainda não estiver instalado.

### MCP (conectar ferramentas externas)

```bash
cp mcp.example.json ~/.gemini-code/mcp.json
# edite os servidores que quiser, depois é só usar o gemini-code normalmente
```

**Spotify, Blender e Roblox Studio (v0.34.0):**

```bash
gemini-code mcp presets                       # lista os presets
gemini-code mcp add spotify --client-id ID --client-secret SEGREDO
gemini-code mcp add blender                   # ou --host IP_DO_PC
gemini-code mcp add roblox                    # ou --ssh usuario@IP_DO_PC
gemini-code mcp check                         # confere preenchimento e comandos
gemini-code mcp off blender                   # desliga sem apagar (mcp on blender liga de novo)
```

Cada comando mostra o que falta fazer (app do Spotify, addon do Blender, ligar o MCP no Studio). Ferramentas que rodam código (Blender/Roblox) pedem `s/n` antes de cada uso. Blender e Roblox Studio só rodam em computador; no celular é preciso apontar para o PC. Requer `uv` (para Spotify e Blender).

## Sobre o "modelo mais forte" (modo ultra)

O modelo usado pelo agente fica em `~/.gemini-code/config.json`, na chave
`model`. Troque para o Gemini mais potente que sua conta tiver acesso quando
quiser mais qualidade de raciocínio (ao custo de ser mais lento/caro):

```bash
gemini-code config show
```

E edite o arquivo `~/.gemini-code/config.json` manualmente para trocar o
campo `"model"`.

## Estrutura do projeto

```
gemini-code/
  bin/gemini-code.js       CLI
  src/agent.js             loop do agente (raciocínio + ferramentas)
  src/gemini.js            wrapper da API do Gemini (nuvem)
  src/providers/llamacpp.js  provedor local Android sem Ollama
  src/providers/ollama.js  compatibilidade opcional com instalações antigas
  src/provider.js          roteador nuvem/local/híbrido + fallback
  src/knowledge.js         conhecimento fixo injetado no prompt
  src/tools/                ferramentas (arquivo, shell, MCP)
  src/skills/loader.js      carregador de skills
  src/agents/runner.js      executor de workflows
  src/workflowCommands.js   comandos /workflows do chat (testáveis)
  src/cowork/               servidor/cliente celular<->PC
  src/voice/voice.js        integração com Termux:API
  skills/                   suas skills (SKILL.md)
  agents/                   personas de agente prontas
  workflows/                workflows de vários passos
  mcp.example.json          exemplo de servidores MCP
  install.sh                instalador para Termux
```

## Observações importantes

- Geração de vídeo/música depende de modelos (Veo/Lyria) que **nem toda
  conta tem liberado** — o comando explica isso quando acontece, em vez de
  travar silenciosamente.
- O comando de shell sempre pede confirmação antes de rodar algo, a não ser
  que você desligue isso em `confirmShell: false` no config (não recomendado).
- O Gemini Cowork só deve ser usado em redes locais de confiança — o token
  protege dentro da rede, mas a porta não deve ser exposta na internet.

## Rotinas persistentes + API (v0.3.13)

O módulo de rotinas é separado da agenda pessoal: ele armazena configurações e
histórico em `~/.gemini-code/routines.json` e
`~/.gemini-code/routine-executions.json`, com gravação atômica. A rotina é criada
como **rascunho** por segurança e só começa a executar depois de ser ativada.

### Exemplo local: monitorar um site

```bash
# Cria uma verificação HTTP, inicialmente em rascunho
gemini-code routines create --name "Site principal" --url https://example.com --every 5m
# Copie o ID que o comando mostrar e ative explicitamente
gemini-code routines activate ID_DA_ROTINA
# Em um terminal ativo, liga o agendador e a API local
gemini-code routines service
```

Outros gatilhos disponíveis:

```bash
# Uma vez, com data ISO incluindo fuso/offset
gemini-code routines create --name "Checagem única" --url https://example.com --at 2026-10-11T08:00:00-03:00
# Cron de cinco em cinco minutos (interpretação em America/Recife por padrão)
gemini-code routines create --name "Site a cada 5 min" --url https://example.com --cron '*/5 * * * *'
# Alternativa para indisponibilidade: agrupar janelas perdidas em uma execução
# (o padrão é skip, ou seja, não repõe execuções atrasadas em massa)
gemini-code routines create --name "Site" --url https://example.com --every 5m --missed-policy run_once
```

Comandos de gerenciamento: `routines list`, `show ID`, `activate ID`, `pause ID`,
`resume ID`, `run ID`, `logs [ID]`, `status` e `remove ID --yes`. No estado atual,
o executor automático implementado é `http-check` (GET com timeout, status HTTP,
retentativas limitadas e histórico). Não há execução genérica de shell ou de
prompts de IA por rotina, para evitar transformar uma definição de rotina em
execução privilegiada não revisada.

### API HTTP autenticada

```bash
gemini-code routines service
# Verifique a disponibilidade (sem dados privados)
curl http://127.0.0.1:8787/health
# A API administrativa requer Bearer token
TOKEN="${ROUTINE_API_TOKEN:-$(cat ~/.gemini-code/routine-api-token.txt)}"
curl -H "Authorization: Bearer $TOKEN" http://127.0.0.1:8787/api/routines
```

Rotas implementadas: `GET /health`, `GET/POST /api/routines`, `GET
/api/routines/{id}`, `POST /api/routines/{id}/activate`, `/pause`, `/resume` e
`/run`, `GET /api/routines/{id}/executions` e `GET /api/executions`. O endpoint
`POST /api/routines` cria somente rascunhos. As rotas administrativas usam token
Bearer, comparação em tempo constante do token, limite de requisições, limite do
corpo JSON e respostas de erro estruturadas. A especificação está em
`docs/openapi-routines.yaml`.

**Segurança:** por padrão, a API escuta somente em `127.0.0.1`. Não a exponha em
HTTP público. Para acesso remoto, utilize TLS/HTTPS por meio de um proxy ou da
terminação HTTPS do provedor, use um token aleatório forte e controle o acesso
à configuração/volume. O token automático é salvo com permissões restritas em
`~/.gemini-code/routine-api-token.txt`; se o serviço o gerar, ele será mostrado
no log apenas durante a primeira criação. Em implantações gerenciadas, prefira
configurar `ROUTINE_API_TOKEN` por meio do gerenciador de segredos.

### Executar na nuvem com o dispositivo desligado

O processo local depende de o host estar ligado. Para executar quando o celular
estiver desligado, implante o serviço Docker em uma VM/contêiner persistente, com
política de reinício e volume persistente:

```bash
cp .env.example .env
# Gere um token com `openssl rand -hex 32` e coloque-o em ROUTINE_API_TOKEN;
# se deixar vazio, o serviço gera um token local salvo no volume
docker compose up --build -d
docker compose logs -f gemini-code-routines
```

O `docker-compose.yml` publicado limita a porta do host a `127.0.0.1:8787` por
padrão. Configure um proxy HTTPS ou a terminação TLS do seu provedor antes de
permitir acesso externo. O diretório `/data` deve persistir entre atualizações e
recriações do contêiner. A imagem expõe health check e reinício automático do
contêiner, mas **não faz deploy em um provedor por conta própria**: a criação da
máquina/serviço cloud, dos segredos, do domínio e do HTTPS ainda exige uma conta
com permissões e configuração do provedor.

### Comportamento de recuperação e limites atuais

O agendador consulta o estado persistido a cada 15 segundos, permite até três
execuções concorrentes, evita duas execuções simultâneas da mesma rotina e
mantém até mil execuções recentes. A política `skip` evita reproduzir em lote as
janelas perdidas após uma interrupção; `run_once` executa uma única vez para
recuperar o atraso. Cron usa cinco campos e o fuso horário configurado. O
verificador bloqueia localhost e IPs privados/reservados por padrão; para uma
rede interna confiável, `ROUTINE_ALLOW_PRIVATE_TARGETS=1` desativa essa barreira
e deve ser usado somente de forma consciente. O
processo deve ficar ativo; a persistência do JSON, sozinha, não executa tarefas.

A implantação cloud, alertas via mensagem, webhooks com assinatura, eventos de
GitHub, workers externos, painel visual, rotinas genéricas de IA/shell e um modo
offline híbrido ainda não estão conectados neste módulo. O projeto original
continua oferecendo Ollama offline e Cowork em rede local, mas essas capacidades
não equivalem a um serviço cloud permanente.


## Recursos novos da v0.3.13 — sessões, checkpoints e artefatos

### Sessões persistentes (memória entre reinícios)

O chat grava o histórico automaticamente em `~/.gemini-code/sessions.json` depois de cada resposta. A sessão ativa volta a ser aberta na próxima inicialização do chat. Dentro do chat:

```text
/session list
/session new Meu projeto
/session use ID_DA_SESSAO
/session rename Nome novo
/session show
```

Na CLI: `gemini-code sessions list`, `sessions new "nome"`, `sessions show ID`, `sessions use ID` e `sessions delete ID --yes`. Os históricos podem conter conteúdo do usuário; mantenha a pasta `~/.gemini-code` protegida e não a compartilhe publicamente.

### Checkpoints do workspace

Crie snapshot do projeto antes de uma mudança arriscada:

```bash
gemini-code checkpoints create --label "antes da refatoração"
gemini-code checkpoints list
gemini-code checkpoints restore ID_DO_CHECKPOINT --yes
```

O checkpoint tem manifesto com hashes SHA-256 e ignora `.git`, `node_modules`, artefatos/builds comuns, links simbólicos e nomes de arquivo de segredos comuns (como `.env` e chaves privadas). Existe limite de 10.000 arquivos e 100 MB por snapshot. A restauração requer `--yes`, valida o snapshot antes de alterar arquivos e cria automaticamente outro checkpoint com o estado atual. Ela restaura os arquivos que constavam no snapshot; **não apaga** arquivos criados depois do checkpoint.

### Artefatos auditáveis

Respostas de `gemini-code run` e turnos bem-sucedidos do chat geram relatórios locais que podem ser consultados depois:

```bash
gemini-code artifacts list
gemini-code artifacts show ID_DO_ARTEFATO
# Executa uma tarefa sem ferramentas de escrita ou shell arbitrário
gemini-code run --profile explore "revise a estrutura e liste riscos"
gemini-code run --profile plan "planeje uma refatoração sem alterar arquivos"
gemini-code run --profile review "revise os riscos de segurança deste projeto"
gemini-code run --profile test "execute as verificações reconhecidas do projeto"
gemini-code profiles list
gemini-code profiles show plan
# Cria um snapshot do workspace antes de permitir alterações do agente
gemini-code run --checkpoint "corrija os testes e valide o build"
```

Cada registro inclui tipo, status, data, tarefa associada e SHA-256 do conteúdo. Os relatórios ficam em `~/.gemini-code/artifacts/` e podem conter trechos da conversa ou do resultado; proteja esses arquivos como dados privados.

### Compatibilidade de arquivos de contexto

O carregador de contexto reconhece, quando presentes, `AGENTS.md`, `GEMINI.md`, `CLAUDE.md`, `.hermes.md`, `SOUL.md`, `.cursorrules`, `CODEX.md`, `ANTIGRAVITY.md`, `KIMI.md`, `KIMI_CODE.md` e `SYSTEM.md`, além dos arquivos de conhecimento do projeto. Confira exatamente o que será carregado com `gemini-code context show`.

`gemini-code doctor` verifica a presença local de executáveis como `claude`, `codex`, `agy`, `hermes`, `kimi`, `higgsfield`, `ollama`, `git` e `docker`. Isso é apenas uma detecção local: não autentica contas e não aciona essas ferramentas automaticamente.

### Referências de arquitetura

A implementação é inspirada em conceitos documentados publicamente, sem copiar código proprietário ou reivindicar paridade total:

- Hermes Agent — memória persistente, Skills, cron e contexto de projeto: https://hermes-agent.nousresearch.com/docs/user-guide/features/overview/
- Claude Code — Skills, configurações e subagentes: https://docs.anthropic.com/en/docs/claude-code/overview
- OpenAI Codex — execução local, aprovações e sandbox: https://help.openai.com/en/articles/11096431
- Google Antigravity — agentes paralelos, tarefas e artefatos verificáveis: https://www.antigravity.google/docs/ide/overview/
- Kimi Code — subagentes isolados coder/explore/plan e fronteiras de permissões: https://www.kimi.ai/help/kimi-code/cli-agents
- Higgsfield — CLI + Skills para geração de imagem/vídeo em agentes de programação; integração opcional: https://higgsfield.ai/creator-hub/help-center/integrations/how-do-i-access-higgsfield-via-cli

Essas referências são ideias de design, não integrações de SDK. A integração com Kimi/Claude/Codex/Hermes/Antigravity não controla as sessões externas. A Skill Higgsfield descreve uma opção de conexão, mas a CLI não instala, autentica nem gera mídia sem solicitação explícita.


### Verificação local de segredos

```bash
gemini-code security scan .
```

A ferramenta procura padrões comuns (tokens de alguns provedores, chaves privadas e atribuições de segredos) e mostra apenas o caminho, a linha e a categoria — nunca o valor detectado. É heurística, pode gerar falsos positivos e não substitui um scanner dedicado nem garante que todos os segredos foram encontrados.
