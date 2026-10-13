# Entrega v0.39.0 — modo solo

- `gemini-code solo on|off|status`: code-ia sozinho, sem Gemini/llama.cpp/Ollama.
- Três travas: roteador, comandos de IA recusados, guarda de rede.
- code-ia entende "rode os testes", "git status", "git log".
- 497 testes passando. Limite: code-ia é busca + n-grama, não LLM.
