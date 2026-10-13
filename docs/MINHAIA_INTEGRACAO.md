# Integração da MinhaIA com Gemini Code

## O que foi integrado

- Projeto Android completo em `mobile/MinhaIA/` (Kotlin/Compose, memória e histórico locais, seletor GGUF e inferência via biblioteca Android de `llama.cpp`).
- Novo parâmetro persistente `llamaCppModelPath` e comando `gemini-code config set-llamacpp-path CAMINHO`. O caminho no ambiente (`LLAMA_MODEL_PATH`) continua tendo prioridade; sem configuração específica, mantém-se o caminho legado do Qwen2.5.
- Script `android/install-minhaia-model.sh` para obter uma revisão fixada do Qwen3-1.7B Q4_K_M a partir da organização oficial Qwen no Hugging Face, conferir SHA-256 antes de ativar o arquivo e configurar o provedor `llamacpp` com contexto de 2048 tokens.
- `android/start-llama-server.sh` detecta o Qwen3 no Downloads compartilhado antes de recorrer ao caminho legado.

## Configurar no Termux

Pré-requisitos: a instalação atual do Gemini Code, `node`, `curl`, `sha256sum` e armazenamento compartilhado do Termux configurado por `termux-setup-storage`. Isso é necessário para que o app Android também possa selecionar o mesmo arquivo.

```bash
bash android/install-minhaia-model.sh
node bin/gemini-code.js llamacpp status
node bin/gemini-code.js chat
```

O script exige espaço livre suficiente e não muda a configuração se o download ou a validação do SHA-256 falhar. O arquivo baixado é salvo em `~/storage/shared/Download/Qwen3-1.7B-Q4_K_M.gguf`. A revisão e o SHA-256 estão fixados no script para reprodutibilidade.

## Compilar o aplicativo Android

```bash
cd mobile/MinhaIA
bash scripts/bootstrap-llama.sh
bash scripts/build-apk.sh
```

O build precisa de Android SDK, NDK, CMake, JDK e conectividade na primeira preparação. O APK não está incluído no ZIP integrado porque esta integração não executou uma compilação Android. Depois da instalação, na tela do app, escolha **Modelo → Importar outro GGUF** e selecione o modelo em Downloads. O aplicativo copia o modelo para o armazenamento privado e valida o cabeçalho GGUF antes de pedir ao motor para carregá-lo.

## Limites desta integração

- CLI e app Android usam o mesmo arquivo de pesos como opção, mas são dois processos distintos e cada um carrega sua própria instância na RAM. Não execute ambos simultaneamente durante os primeiros testes em um aparelho com 8 GB.
- Histórico e memórias do Gemini Code e da MinhaIA não são sincronizados nem compartilhados nesta versão.
- O Qwen3-1.7B Q4_K_M foi selecionado como ponto de partida por tamanho; não há alegação de velocidade, temperatura, qualidade ou estabilidade até que o app seja compilado e testado fisicamente.
- O modo offline do CLI depende de `llama-server` ativo e não utiliza Gemini quando `provider=llamacpp`. O app Android não necessita de API no caminho de inferência e seu manifesto não declara a permissão `INTERNET`.
- O download de pesos é separado do código-fonte. Consulte a página do modelo e a licença antes de redistribuir pesos: https://huggingface.co/Qwen/Qwen3-1.7B-GGUF/tree/7fb011e9aee6e4dc7adf8430df9ea8de6a466aa3
