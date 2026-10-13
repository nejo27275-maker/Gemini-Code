# Entrega v0.33.0 — saída de comando enxuta

- Novo `src/outputCompact.js`, aplicado em `cortarResultado` só para run_shell/run_checks.
- Remove ANSI, progresso \\r e linhas repetidas; arquivos lidos ficam intactos.
- 451 testes passando. Não testado em Termux real.
