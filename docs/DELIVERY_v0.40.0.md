# Entrega v0.40.0 — segurança das ferramentas e avaliação reproduzível

- Corrigido: o modelo gravava `hooks.json` e rodava comando sem confirmação (P1); symlink/hard link furava a proteção do config (P1); API key e token do cowork legíveis por outros usuários (P2); `run` sem terminal saía no meio com código 0 (P2); cowork aceitava 100 MiB antes da autenticação (P3).
- `evals/`: 6 tarefas com verificador oculto, para medir qualquer agente nas mesmas condições (`docs/EVALS.md`).
- 524 testes passando. Medido: code-ia solo 0/6. Não executados: Gemini, llama.cpp, Termux real e outros agentes.
