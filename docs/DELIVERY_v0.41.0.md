# Entrega v0.41.0 — as duas falhas corrigidas e as lacunas frente aos outros agentes

- Corrigido: lista vazia de ferramentas liberava todas (P1); a sessão de convidado lia o token do cowork e virava dona (P1); anti-SSRF furado por IPv6 (P1); chaves vazando para MCP, log e URL (P2); instruções de repositório sem pergunta de confiança (P2); chat retomando a conversa de outro projeto (P2).
- Novo: provedor `openai` (OpenRouter, OpenAI e APIs compatíveis), `edit_files`, `glob_files`, `web_fetch`, comandos em segundo plano, regras de permissão, poda de contexto e `/compact ia`, hooks UserPromptSubmit/SessionStart/Stop, subagentes do usuário, MCP remoto, imagem como entrada, `run --json`, tarefa de avaliação nova.
- Revisão adversarial antes de fechar: 22 defeitos reproduzidos nas novidades (3 P1, entre eles DNS rebinding no `web_fetch`), todos corrigidos com teste que falha no código anterior.
- 700 testes (699 passando, 1 pulado como root) no Node 20 e 22. Não executados: Gemini, llama.cpp, API compatível com OpenAI real, Claude Code, Codex, Antigravity, Hermes Agent — não há comparação medida entre agentes, só as ferramentas para fazê-la (`docs/EVALS.md`).
