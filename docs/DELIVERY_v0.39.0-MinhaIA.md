# Entrega: integração MinhaIA + Gemini Code

## Integrado

- App Android nativo em `mobile/MinhaIA/`.
- Configuração de caminho de GGUF no Gemini Code (`llamaCppModelPath` / `config set-llamacpp-path`).
- Script Android/Termux para baixar o Qwen3-1.7B Q4_K_M da revisão fixada, validar SHA-256 e configurar o Gemini Code para `llamacpp` com 2048 tokens.
- Documentação de configuração, build e limitações de compartilhamento.

## Validações executadas neste ambiente

- `node --check` nos arquivos JavaScript modificados: aprovado.
- `bash -n android/install-minhaia-model.sh android/start-llama-server.sh`: aprovado.
- `python mobile/MinhaIA/scripts/validate-source.py`: aprovado (verificações estáticas de arquivos, XML e manifesto).
- `npm test`: 498 testes aprovados, 0 falhas.
- `npm run lint`: verificação sintática em 134 arquivos JavaScript aprovada. ESLint não estava instalado, então regras de estilo do ESLint não foram executadas.
- Build Android/Gradle, carregamento do modelo e teste no Galaxy A55: não executados neste ambiente.

## Limitações conhecidas

A inclusão do subprojeto e a configuração do provedor não sincronizam histórico ou memória entre CLI e app. Ambos podem usar o mesmo arquivo GGUF, mas são processos separados e carregam suas próprias instâncias. O APK não foi gerado nesta entrega; requer build Android com SDK/NDK/JDK e verificação prática no dispositivo.
