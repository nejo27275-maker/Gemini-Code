# Compilação e instalação

## Requisitos de build

- Computador com Android Studio e Android SDK, ou ambiente equivalente.
- JDK 17+.
- Android SDK Platform 36 (o mesmo baseline da biblioteca Android oficial do llama.cpp).
- Android NDK `29.0.13113456`.
- CMake `3.31.6` instalado pelo SDK Manager.
- Git, Python 3, `curl`, `unzip` e `sha256sum`.
- Rede durante a primeira preparação/compilação para obter o código de `llama.cpp`, a distribuição Gradle (se necessária) e dependências Maven.

## Passos

```bash
unzip MinhaIA.zip
cd MinhaIA
export ANDROID_SDK_ROOT="$HOME/Android/Sdk"  # ajuste para a pasta real do SDK
bash scripts/check-environment.sh
bash scripts/bootstrap-llama.sh
bash scripts/build-apk.sh
```

No Android Studio, também é possível abrir a pasta do projeto **depois** de executar `bootstrap-llama.sh`. Se faltar algum componente, abra Tools → SDK Manager e instale os pacotes exatos indicados no relatório de ambiente.

O APK de debug esperado fica em `app/build/outputs/apk/debug/app-debug.apk`. A compilação só deve ser considerada concluída se o comando Gradle terminar com código zero e o APK existir.

## Instalar

- Com ADB: ative Opções do desenvolvedor → Depuração USB, conecte e autorize o computador, depois rode `bash scripts/install-apk.sh`.
- Sem ADB: transfira o APK para o aparelho e abra-o usando o instalador de pacotes do Android. Só permita a instalação para a fonte que você está usando e volte a desativar essa permissão depois.

A compilação com `targetSdk 36` e `minSdk 33` requer Android 13 ou superior. Confirme em Configurações → Sobre o telefone a versão real do Android e em Informações do software a versão do One UI.

## Problemas comuns

- `llama.android/lib` ausente: rode `bash scripts/bootstrap-llama.sh` com internet.
- SDK/NDK/CMake ausente: configure no Android Studio SDK Manager e confirme `ANDROID_SDK_ROOT`.
- Erro JNI/native build: preserve o log completo, o commit gravado em `docs/LLAMA_CPP_REVISION.txt` e não aplique patches manuais adicionais antes de identificar o erro.
- Arquivo GGUF recusado: verifique se o download terminou, se a extensão/conteúdo corresponde a GGUF e se a arquitetura é suportada pela versão atual do motor.
- Memória insuficiente ou Android encerrando o app: feche apps pesados, reinicie o aparelho e comece com o 1.7B Q4; não carregue múltiplos modelos simultaneamente.
- Aquecimento: pare o uso se o aparelho ficar desconfortavelmente quente; sessões longas de inferência podem aquecer o telefone.


O projeto aplica temporariamente `android.builtInKotlin=false` e `android.newDsl=false` porque a biblioteca upstream `llama.android` ainda aplica o plugin `kotlin-android`. Isso evita a incompatibilidade de migração do AGP 9; esses sinalizadores devem ser reavaliados quando a biblioteca upstream migrar para Kotlin integrado.
