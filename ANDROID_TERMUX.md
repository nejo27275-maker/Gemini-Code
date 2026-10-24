# Gemini Code no Android — internet + offline, sem Ollama

Este projeto é uma aplicação de terminal para Android via **Termux**, não um APK Android com interface própria. A IA local é executada pelo `llama.cpp`; o projeto não exige Ollama. A primeira instalação precisa de internet para baixar dependências, compilar o motor e baixar o modelo GGUF. Depois disso, o modelo local pode responder sem conexão.

## Requisitos

- Android com Termux atualizado, preferencialmente instalado pelo F-Droid ou repositório oficial do Termux.
- Espaço livre para o projeto, dependências e um modelo de aproximadamente **986 MB**; reserve pelo menos 2–3 GB para evitar falta de espaço durante instalação/execução.
- Um dispositivo com memória suficiente para carregar o modelo. Em celulares com pouca RAM, o Android pode encerrar o processo.

## Instalação — copiar e colar

1. Baixe e extraia o ZIP do Gemini Code. O projeto deve ficar em `Download/gemini-code`.
2. Abra o Termux e execute:

```bash
termux-setup-storage
cp -r ~/storage/shared/Download/gemini-code ~/gemini-code
cd ~/gemini-code
bash android/termux-install.sh
```

Se a pasta extraída tiver outro nome ou caminho, ajuste apenas o caminho do `cp -r`. O script instala Node.js e ferramentas de compilação, compila `llama.cpp`, baixa o modelo `Qwen2.5-1.5B-Instruct-Q4_K_M.gguf`, verifica o SHA-256 e define `hybrid` como modo padrão. A compilação pode levar um tempo e esquentar o celular; o script limita a compilação a dois jobs para reduzir o pico de memória.

## Usar o modelo da MinhaIA Android no Gemini Code (opcional)

O projeto também contém o app nativo em `mobile/MinhaIA`. Para configurar o CLI e o app para usarem o mesmo arquivo GGUF, execute primeiro `termux-setup-storage` e autorize o acesso ao armazenamento compartilhado. Depois, na raiz do repositório:

```bash
bash android/install-minhaia-model.sh
node bin/gemini-code.js chat
```

Esse script baixa a revisão fixa de `Qwen/Qwen3-1.7B-GGUF` (quantização Q4_K_M), verifica o SHA-256 e configura o Gemini Code com `llama.cpp`, caminho do arquivo em Downloads e contexto de 2048 tokens. O instalador legado acima continua disponível e mantém o Qwen2.5 como padrão para instalações existentes.

Para compilar o app Android, abra `mobile/MinhaIA` no Android Studio ou siga `mobile/MinhaIA/docs/INSTALACAO.md`. Depois de instalar o APK, selecione **Modelo → Importar outro GGUF** e escolha o arquivo em Downloads. O app copia o modelo para seu próprio armazenamento: o uso simultâneo do arquivo de origem e da cópia pode exigir cerca de 2,3 GB adicionais. O ZIP não contém o peso do modelo nem um APK pré-compilado.

## Abrir a IA

Uma aba só. O instalador já ativa o início automático: o modelo local sobe sozinho, em segundo plano, na primeira pergunta (carregar leva cerca de 1 minuto).

```bash
cd ~/gemini-code
node bin/gemini-code.js chat
```

Controle manual, se preferir:

```bash
node bin/gemini-code.js llamacpp start    # liga em segundo plano e espera ficar pronto
node bin/gemini-code.js llamacpp status   # pronto / carregando / offline
node bin/gemini-code.js llamacpp log      # últimas linhas do log
node bin/gemini-code.js llamacpp stop     # desliga e libera a memória
bash android/start-llama-server.sh        # alternativa em primeiro plano (log ao vivo)
```

O contexto padrão é **4096 tokens**. Para mudar (precisa ser igual no servidor e no config): `LLAMA_CTX=8192 node bin/gemini-code.js llamacpp start` e `node bin/gemini-code.js config set-llamacpp-ctx 8192`. Contexto maior usa mais RAM. `/local` força o modelo offline; `/cloud` força o Gemini online se uma chave estiver configurada; `/auto` volta para o roteador do projeto.

## Usar internet e offline

- **Offline:** o GGUF precisa ter sido baixado e `llama-server` precisa estar rodando. O modo local não faz buscas na web sozinho.
- **Online:** para usar a API Gemini, configure uma chave sua do Google AI Studio:

```bash
node bin/gemini-code.js config set-key SUA_CHAVE
node bin/gemini-code.js config set-provider hybrid
```

No modo híbrido, pedidos que o roteador considera complexos vão para a nuvem; os outros usam `llama.cpp`. Se o acesso à nuvem falhar por rede, o projeto tenta o modelo local quando aplicável. Disponibilidade e cotas da API dependem da conta e do modelo escolhido. Nunca compartilhe sua chave nem a coloque em arquivos que enviará a outras pessoas.

Para sempre usar apenas o modelo local, mesmo com chave configurada:

```bash
node bin/gemini-code.js config set-provider llamacpp
```

## Como ensinar sua IA

1. Abra `android/MEUS_CONHECIMENTOS.md` e adicione instruções, informações e exemplos específicos do seu projeto. Não inclua senhas, tokens ou dados privados.
2. Importe o arquivo no conhecimento persistente do Gemini Code:

```bash
node bin/gemini-code.js knowledge add android/MEUS_CONHECIMENTOS.md
node bin/gemini-code.js knowledge list
```

Esses textos passam a acompanhar as instruções enviadas ao modelo. Isso é **ensino por contexto/memória**, não muda os pesos do Qwen. O comando `code-ia learn` treina/atualiza o mecanismo pequeno `code-ia`, mas ele não substitui um modelo de linguagem geral. Fine-tuning de verdade (por exemplo, LoRA) requer um conjunto de dados e normalmente é realizado em um computador ou serviço com mais memória; não acontece automaticamente no celular.

## Diagnóstico e solução de problemas

- `gemini-code doctor`: mostra se o `llama-server` e o GGUF existem, o contexto, o autostart e o espaço livre.
- `gemini-code llamacpp status`: testa o servidor local (pronto / carregando / offline). Se der "carregando", espere o modelo terminar de ler.
- Se a resposta disser que a conversa passou do contexto, use `/compact` ou `/clear`.
- Se a resposta disser que não consegue conectar, verifique a primeira sessão do Termux: ela deve continuar executando `llama-server` na porta 8080.
- Se o modelo não carregar, confira se existe `~/models/Qwen2.5-1.5B-Instruct-Q4_K_M.gguf` e se há espaço/RAM suficiente.
- Para trocar a URL local: `node bin/gemini-code.js config set-llamacpp-url http://127.0.0.1:8080`.
- Sandbox do shell (v0.45.0): o Android não deixa um app comum criar os namespaces que ela usa, então no Termux os comandos do agente rodam como antes — a barreira é a confirmação (deixe `confirmShell` ligado). `gemini-code sandbox` mostra isso. Gravar fora da pasta do projeto pergunta antes, aqui também.
- O modelo Qwen é fornecido pela comunidade bartowski no Hugging Face e tem licença Apache-2.0 indicada no card do modelo. O arquivo de pesos não está incluído neste ZIP; o script o baixa na primeira instalação.
