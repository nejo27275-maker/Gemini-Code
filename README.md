# gemini-code

Um agente de terminal no espírito do **Claude Code** / **Codex**, só que usando a
**API do Gemini** do Google — feito para rodar no **Termux** (Android) ou em
qualquer PC/Linux com Node.js.

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

## Instalação (Termux)

```bash
unzip gemini-code.zip
cd gemini-code
bash install.sh
gemini-code config set-key SUA_CHAVE_DO_GEMINI
```

Pegue sua chave grátis em <https://aistudio.google.com/apikey>.

## Instalação (PC / Linux / Mac)

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
  src/gemini.js            wrapper da API do Gemini
  src/tools/                ferramentas (arquivo, shell, MCP)
  src/skills/loader.js      carregador de skills
  src/agents/runner.js      executor de workflows
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
