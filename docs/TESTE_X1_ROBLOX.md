# Teste X1 — quem faz o melhor jogo no Roblox?

Comparar **Gemini Code (este projeto)**, **Claude Code** e **Codex**, todos com o servidor MCP do Roblox Studio, no mesmo pedido.
Resultado esperado: uma tabela de notas SUA. Nenhum resultado foi medido ainda — este arquivo é só o roteiro.

## Regras (iguais para os três)
1. Mesmo computador, mesmo Roblox Studio, **um lugar (place) novo e vazio** para cada um.
2. Mesmo MCP: Studio → Assistente → ⋯ → Gerenciar servidores MCP → "Enable Studio as MCP server".
3. **Mesmo prompt**, colado uma única vez (abaixo). Sem ajuda humana durante a construção, a não ser responder pedidos de confirmação (s/n). Se precisar ajudar, anote ("ajuda: sim").
4. **Mesmo limite de tempo** (sugestão: 30 minutos) e mesmo modelo/nível de raciocínio quando der para escolher. Anote o modelo usado.
5. Depois, **você joga cada resultado** e dá as notas sem saber qual é qual (peça a um amigo para renomear as pastas A/B/C, se possível).

## Prompt padrão
> Crie no Roblox Studio um obby (jogo de obstáculos) com 5 fases de dificuldade crescente: plataformas móveis, lava que mata, checkpoints que salvam a fase atual, uma tela com cronômetro e fase atual, e um placar (leaderboard) com a fase mais alta. Ao chegar na fase 5, mostre uma mensagem de vitória e reinicie. Organize os scripts em servidor e cliente. Teste no playtest e corrija os erros que aparecerem.

## Rubrica (0 a 10 cada, você preenche)
| Critério | Gemini Code | Claude Code | Codex |
|---|---|---|---|
| 1. Roda sem erro no console | | | |
| 2. Objetivo claro, dá para vencer e perder | | | |
| 3. Tudo que o prompt pediu está presente | | | |
| 4. Código Luau (organização, cliente/servidor) | | | |
| 5. Interface e feedback ao jogador | | | |
| 6. Visual do mapa | | | |
| 7. Diversão e ritmo | | | |
| 8. Autonomia (quanto precisou de ajuda) | | | |
| **Média** | | | |

Desempate: qual você jogaria de novo.

## Como rodar no Gemini Code
No PC com o Studio aberto (ou no celular com `--ssh`, veja o README):
```bash
gemini-code mcp add roblox
gemini-code chat
```
Dentro do chat:
```
/workflows instalar jogo-roblox-x1
/workflows validar jogo-roblox-x1
/workflows rodar jogo-roblox-x1 ideia="<cole aqui o prompt padrão, entre aspas>"
```
O workflow faz plano → constrói → playtest → nota própria (serve só de comparação; a nota que vale é a sua). Se a execução parar no meio, `/workflows retomar jogo-roblox-x1` continua do passo certo sem refazer os anteriores. O resumo de tokens gastos fica em `/workflows historico`.

## Cuidados
- Rode só em lugar de teste: o MCP edita e executa código no Studio aberto.
- Não compartilhe a conta/publicação do jogo durante o teste.
- A nota automática do Gemini Code tende a ser otimista; por isso a rubrica manda limitar a 5 o que não foi testado.
