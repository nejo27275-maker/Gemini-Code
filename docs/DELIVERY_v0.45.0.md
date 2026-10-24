# Entrega v0.45.0 — sandbox do sistema para o shell

- Sandbox do `run_shell` (Linux + bubblewrap, `src/sandbox.js`): o que roda sem aprovação na hora (confirmShell desligado, regra "permitir", rotina) roda isolado — disco só leitura menos o projeto, `.git` só leitura, `~/.gemini-code` e credenciais invisíveis, sem rede, `/tmp` descartável, seccomp sem socket `AF_UNIX`/io_uring/chaveiro, sem capabilities.
- Modos `auto` (padrão), `sempre` e `off`; sair da sandbox (`fora_da_sandbox`) sempre pergunta. Rotinas rodam `run_shell` na sandbox em vez de recusar.
- `gemini-code sandbox` / `sandbox testar "cmd"`, `config set-sandbox`, `set-sandbox-rede`, `add-pasta-gravavel`, `set-confirmar-fora`; `doctor` mostra a sandbox.
- `write_file`/`edit_file`/`edit_files` perguntam antes de gravar fora do projeto; nada dentro do `.git`.
- Corrigido (segurança): o autoGit rodava `core.fsmonitor` plantado no `.git/config` a cada turno; agora roda o git blindado e pula repositório com filtro na config.
- Corrigido: encerrar um comando de fundo no começo deixava o processo da sandbox órfão.
- Testes: 846 (845 passando, 1 pulado como root) no Node 20 e 22, com a sandbox real; também como usuário comum. CI instala o bubblewrap e exige os testes reais. Só Linux: Termux, macOS e Windows seguem como antes.
