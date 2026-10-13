# Minha IA — Android local/offline (alpha)

Aplicativo Android em Kotlin + Jetpack Compose para conversar com um modelo GGUF executado no próprio aparelho. O motor nativo vem do projeto oficial `ggml-org/llama.cpp`, por meio do exemplo/biblioteca `examples/llama.android/lib`; a preparação faz um patch local conservador para contexto de 2.048 tokens e lote de 128; o wrapper local também é ajustado para permitir reconstrução do prompt entre turnos.

**Status honesto desta entrega:** fonte e scripts do projeto foram criados e passaram pelas validações estáticas disponíveis neste ambiente. Este ambiente não tem Android SDK, NDK, Gradle nem dispositivo Android conectado; portanto, não é possível afirmar que o APK foi compilado, instalado ou que o motor rodou no Galaxy A55. Veja `docs/TESTES.md`.

## O que já está implementado

- Chat Compose e geração por fluxo de tokens usando a biblioteca Android oficial do `llama.cpp`.
- Importação de modelos GGUF pelo seletor do Android, validação do magic `GGUF`, cópia para a pasta privada do app e seleção entre modelos importados.
- Contexto nativo reduzido a 2.048 tokens; lote de processamento definido em 128; prompt do sistema reconstruído entre turnos a partir do banco local; respostas limitadas a 32–512 tokens (padrão 192).
- Histórico SQLite, perfil/personalidade local, memórias adicionadas explicitamente e recuperação por sobreposição de palavras-chave.
- Importação de documentos TXT com limite de tamanho e recuperação local de trechos relevantes.
- Exportação/importação de backup JSON, limites de tamanho e validação básica de esquema.
- Sem permissão `INTERNET`, telemetria ou anúncios no manifesto. Inferência não chama API remota.
- Testes unitários para composição de contexto e dados importados.

## Primeira configuração

1. Use um computador com Android Studio atualizado (ou um ambiente com Android SDK instalado). Instale Android SDK Platform 36, Android NDK `29.0.13113456`, CMake `3.31.6` e Java 17 ou superior.
2. Extraia o ZIP e entre na pasta `MinhaIA`.
3. Configure `ANDROID_SDK_ROOT` ou `ANDROID_HOME` para a pasta do SDK.
4. Execute `bash scripts/bootstrap-llama.sh`. Esse passo baixa **código-fonte** de `https://github.com/ggml-org/llama.cpp`, não baixa o modelo. A conexão é necessária somente na preparação/compilação.
5. Execute `bash scripts/build-apk.sh`. O script verifica o ambiente, usa Gradle 9.6.0 se disponível ou baixa a distribuição oficial e verifica sua soma SHA-256, compila o APK de debug e executa os testes unitários.
6. Se concluir com sucesso, o APK estará em `app/build/outputs/apk/debug/app-debug.apk`.
7. Para instalar com um dispositivo autorizado via ADB, execute `bash scripts/install-apk.sh`. Alternativamente, transfira o APK para o celular, habilite a instalação desse arquivo nas configurações do Android e instale-o manualmente.
8. Baixe o modelo de uma fonte oficial, confira licença e integridade, e importe o `.gguf` no app.
9. Depois do primeiro carregamento, ative o modo avião e faça algumas perguntas para verificar o funcionamento offline real.

## Modelo inicial recomendado

Comece com **Qwen/Qwen3-1.7B-GGUF**, arquivo `Qwen3-1.7B-Q4_K_M.gguf` (listado com aproximadamente 1,11 GB, licença Apache-2.0 no repositório do modelo). Abra a página oficial: <https://huggingface.co/Qwen/Qwen3-1.7B-GGUF> e escolha o arquivo. Não incluímos os pesos no ZIP por causa do tamanho e para preservar a distribuição independente do modelo.

Não é promessa de velocidade ou qualidade: desempenho depende da versão do Android, espaço livre, temperatura, memória disponível, modelo e quantização. O 4B pode exigir vários GB de RAM de trabalho além do arquivo; teste primeiro o modelo 1.7B Q4.

## Observações importantes

- A biblioteca Android upstream pode mudar. O script valida os arquivos e constantes esperados e falha em vez de aplicar uma substituição ambígua. `docs/LLAMA_CPP_REVISION.txt` registra o commit efetivamente obtido.
- A fonte de `llama.cpp` é obtida separadamente; para reconstruir exatamente a mesma combinação, preserve `external/llama.cpp` e `docs/LLAMA_CPP_REVISION.txt`. Ao iniciar uma nova preparação, é possível definir `LLAMA_CPP_REF` para uma tag ou commit compatível.
- Não há treinamento dos pesos neste app. Perfil, histórico, memórias e documentos são contexto local recuperado e inserido no prompt.
- A busca em memórias/documentos é uma recuperação lexical simples, não embeddings semânticos.
- Voz offline e leitura de PDF ainda não estão implementadas.
- O formato GGUF é verificado superficialmente no momento da importação; validação completa de arquitetura e tensores é feita pelo motor ao carregar. Nem todo arquivo GGUF é compatível.
- O seletor copia o modelo para armazenamento privado; garanta espaço livre suficiente. A primeira cópia pode demorar.

## Estrutura

- `app/`: UI, importação, persistência, perfil e testes.
- `scripts/`: preparar e adaptar com segurança o motor nativo, validar ambiente, compilar e instalar.
- `docs/`: arquitetura, instalação, offline, modelos, privacidade, testes e treinamento futuro.
- `gradle/libs.versions.toml`: versões da toolchain e bibliotecas.
