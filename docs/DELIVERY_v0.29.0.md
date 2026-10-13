# Entrega v0.29.0 — pacote Android sem Ollama

- Novo provedor `src/providers/llamacpp.js` usando endpoint OpenAI-compatible do `llama.cpp`.
- Roteador híbrido agora usa `llama.cpp` local como padrão offline; se uma chave Gemini existir, pedidos mais complexos podem usar a nuvem.
- Configuração e comandos `llamacpp status`, `set-llamacpp-url` e `set-llamacpp-model`.
- Scripts Android/Termux para preparar Node.js, compilar `llama-server`, baixar e validar um modelo GGUF compacto.
- Guia `ANDROID_TERMUX.md` e arquivo inicial `android/MEUS_CONHECIMENTOS.md` para ensinar informações personalizadas.
- Mantida compatibilidade com o provedor Ollama para instalações antigas; Ollama não é requisito do pacote Android.
- Testes: `npm test` (430 testes passando após adicionar testes do provedor e migração de configuração); verificação real em Termux/Android ainda não executada neste ambiente.
- Limite: arquivo GGUF de cerca de 986 MB é baixado por script e não é embutido no ZIP. Conhecimento adicionado via arquivos entra no contexto do prompt, não altera os pesos do modelo.
