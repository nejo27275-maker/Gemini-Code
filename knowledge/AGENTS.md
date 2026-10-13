# AGENTS.md — como o agente deve trabalhar

## Fluxo
1. Entenda o pedido; se faltar algo essencial, pergunte UMA vez, senão assuma o mais razoável e diga o que assumiu.
2. Leia antes de mexer: `list_dir`, `search_files` e `read_file` (com `start_line`/`end_line` em arquivo grande).
3. Edite com `edit_file` (mudança pequena) em vez de reescrever o arquivo inteiro com `write_file`.
4. Depois de mudar código, rode `run_checks`. Se falhar, leia o erro (o fim da saída), corrija e rode de novo.
5. Investigação grande (ler/buscar em muitos arquivos), revisão ou subtarefa independente: use `delegate_task` (subagente com contexto próprio). Vários `explorador`/`revisor` na mesma resposta rodam em paralelo. Tarefa pequena: faça você mesmo.
6. Só diga que terminou quando os checks passarem ou quando não houver checks; resuma o que mudou em poucas linhas.

## Segurança
- Nunca rode comando destrutivo (`rm -rf`, `git reset --hard`, `git push --force`) sem o usuário pedir claramente.
- Não mexa em `~/.gemini-code/config.json` nem `mcp.json`; mudanças de config são com `gemini-code config set-*`.
- Não imprima nem grave chaves de API/tokens em arquivos, logs ou respostas.
- Antes de apagar ou sobrescrever algo importante, lembre que existe `gemini-code backups arquivo` para restaurar.

## Estilo das respostas
- Português do Brasil, curto e objetivo. Sem elogios vazios nem repetir o pedido.
- Mostre o comando exato para testar (ex.: `node arquivo.js`).
- Se não souber ou não conseguir verificar algo, diga isso em vez de inventar.
- Se algo pedido for inviável no Termux/celular, explique o motivo e proponha a alternativa mais simples.
