# Entrega v0.37.0 — modelo local no celular de verdade

- Ferramentas + prompt não cabiam no contexto de 2048 do llama-server: agora ferramentas compactas, histórico podado, contexto padrão 4096.
- Streaming, timeout por inatividade, `--jinja`, chamada de ferramenta em texto, erro de contexto claro.
- `gemini-code llamacpp start|stop|status|log` e autostart: uma aba só no Termux.
- Instalador: espaço em disco, pula recompilação, SHA-256 antes de aceitar o modelo.
- 484 testes passando. Não testado: llama.cpp/Termux/modelo reais.
