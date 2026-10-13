# Relatório de entrega — Gemini Code v0.3.14

Data da revisão: 10 de outubro de 2026.

## O que mudou

- Perfis de tarefa com allowlists reais: `coder`, `explore`, `plan`, `review` e `test`.
- Comando `profiles list|show` e argumento `run --profile ...`; `run --read-only` continua compatível e seleciona `explore`.
- Papéis de subagente em inglês alinhados ao fluxo Kimi Code (`explore`, `plan`, `reviewer`, `coder`), mantendo aliases em português e o limite de delegação existente.
- Descoberta de arquivos de contexto `KIMI.md`, `KIMI_CODE.md` e `SYSTEM.md`.
- Diagnóstico local de executáveis `kimi`, `kimi-code` e `higgsfield` em `doctor`.
- Skills `kimi-agent-workflow` e `higgsfield-integration`.
- Documentação de interoperabilidade atualizada e testes de permissões de perfis.

A base também contém as funcionalidades da v0.3.13: sessões persistentes, checkpoints com SHA-256, artefatos verificáveis, scanner heurístico de segredos e rotinas locais persistentes.

## Validação executada

| Verificação | Resultado | Detalhe |
|---|---|---|
| Testes direcionados | Aprovado | `node --test tests/agentProfiles.test.js tests/persistentFeatures.test.js tests/securityScan.test.js` — 11/11 passaram |
| Suíte completa | Parcial | `npm test` — 166/187 passaram; 21 falharam na inicialização por dependências ausentes (`chalk` e `ws`) |
| Sintaxe JavaScript | Aprovado | `node --check` aplicado a todos os arquivos `.js` em `src`, `bin` e `tests` |
| Scanner de padrões de segredo | Aprovado, com limite | 107 arquivos verificados; 0 padrões encontrados. Um scanner heurístico não garante ausência de segredos |
| Lint | Bloqueado | `npm run lint` não pôde iniciar porque `eslint` não está instalado |
| Instalação de dependências | Bloqueada | A tentativa anterior de `npm ci` não conseguiu alcançar `registry.npmjs.org` (`EAI_AGAIN`), erro de DNS/rede do ambiente |
| Build Docker / implantação | Não executados | Não há evidência de build em ambiente com dependências nem de implantação em nuvem |

## Referências e integração externa

- Kimi Code: incorporamos padrões de desenho para papéis `explore`, `plan` e `coder` e limites de delegação; não existe integração de conta/sessão/API com o Kimi Code.
- Higgsfield: existe uma Skill que documenta a conexão opcional oficial CLI + Skills para geração de imagem/vídeo. O binário é apenas detectado por `doctor`; não instalamos, autenticamos ou geramos mídia. A geração pode consumir créditos da conta e precisa de pedido/autorização explícitos.
- Claude Code, Codex, Hermes e Antigravity: usados como referências de arquitetura; a presença de executáveis é apenas diagnóstico local, não integração de sessões externas.

## Como testar após instalar dependências

```bash
npm ci
npm test
npm run lint
node bin/gemini-code.js profiles list
node bin/gemini-code.js profiles show plan
```

Para executar tarefas com permissões limitadas:

```bash
gemini-code run --profile explore "mapeie a arquitetura sem alterar arquivos"
gemini-code run --profile plan "planeje uma refatoração sem editar"
gemini-code run --profile review "procure bugs reproduzíveis e riscos"
gemini-code run --profile test "inspecione e execute as verificações reconhecidas"
```

## Limitações conhecidas

- As rotinas são locais enquanto `gemini-code routines service` estiver ativo; não há implantação de worker/agendador em nuvem feita por esta entrega.
- Os perfis são controles no nível da aplicação e não substituem sandbox do sistema operacional/contêiner.
- Não há swarm ilimitado, execução em background garantida, adaptador de API Kimi, sessão sincronizada com ferramentas externas ou geração Higgsfield ativa.
- As dependências precisam ser instaladas e a suíte completa repetida antes de declarar a release totalmente validada.
