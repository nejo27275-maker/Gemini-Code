# Entrega v0.42.0 — agentes pessoais (como os GPTs do ChatGPT)

- Base: v0.41.0 (branch `claude/rlr-omni-evolution-fqrsux`, ainda fora do `main`) incorporada sem alterações.
- Novo: `gemini-code gpts` — agentes com instruções, iniciadores, base de conhecimento (trechos relevantes por BM25 a cada mensagem + `knowledge_search`), memória persistente (`memory_save`/`memory_forget`, com confirmação por padrão), ferramentas e modelo próprios, conversas próprias, criação pela IA com prévia e confirmação, exportar/importar (inclusive as personas antigas). No chat: `/gpts`, `/gpt NOME`, `@NOME mensagem`, `/memoria`.
- Segurança: `~/.gemini-code/gpts/` é pasta protegida (o modelo não grava ali, nem por symlink/hard link; `run_shell` mencionando-a pede confirmação); arquivos 0600, pasta 0700; ferramentas de memória só na conversa com o agente e nunca para convidado.
- Corrigido: no modelo local, a instrução da persona/perfil/modo plano era a primeira parte do prompt a ser cortada; agora o conhecimento fixo é cortado antes.
- Testes: 726 (725 passando, 1 pulado como root; eram 700) no Node 22; inclui três de ponta a ponta com o CLI real e um servidor local imitando a API da OpenAI. Não executados: Gemini, llama.cpp ou API real (sem chave nem rede aqui) e ESLint (registro do npm bloqueado pela política de rede da sessão).
