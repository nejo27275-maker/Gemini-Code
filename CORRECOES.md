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

## O que eu NÃO mudei, mas vale seu olho

O pacote `@google/generative-ai` (o que este projeto usa pra falar com a
API) foi **arquivado pelo Google** — não recebe mais atualizações. Ele deve
continuar funcionando por um bom tempo, mas é o pacote antigo; o atual é o
`@google/genai`. Um ponto específico de atenção: modelos Gemini 3 (o padrão
deste projeto) usam "thought signatures" em conversas com várias chamadas de
ferramenta em sequência — se um dia você notar o agente perdendo o fio da
meada especificamente em tarefas longas com muitas ferramentas encadeadas,
esse é o primeiro lugar que eu investigaria, e a solução seria migrar pro
`@google/genai`. Não mexi nisso agora porque é uma migração maior e eu não
tenho como testar contra a API de verdade daqui.
