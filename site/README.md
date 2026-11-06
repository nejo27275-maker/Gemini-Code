# Site dos apps de estudo

Esta pasta é um site pronto (sem servidor e sem banco de dados):

- `index.html`: página inicial para escolher o app.
- `estudo-gamer/`: Estudo Gamer (AV2 de dezembro, 5º ano).
- `missao-saber/`: Missão Saber (6 matérias, 30 assuntos).
- `sw.js`, `*/manifest.webmanifest` e `icons/`: deixam os apps instaláveis no celular e funcionando sem internet depois da primeira visita.

Os arquivos são gerados pelo mesmo build de `estudo_interativo.html` e `missao_saber.html` (na raiz do repositório). Não edite à mão.

## Como colocar no ar (GitHub Pages, grátis)

1. No GitHub, abra o repositório → **Settings** → **Pages**.
2. Em **Build and deployment**, escolha **Source: Deploy from a branch**.
3. Escolha o branch (o deste PR ou o `main`, depois de juntar o PR) e a pasta **/ (root)**. Clique em **Save**.
4. Em 1 ou 2 minutos o site fica em: `https://<seu-usuario>.github.io/<nome-do-repositório>/site/`

O arquivo `.nojekyll` na raiz faz o GitHub Pages entregar os arquivos como estão.

## O que muda em relação à versão do claude.ai

- O progresso fica salvo no aparelho. Para levar para outro aparelho: **Perfil → Código da conta** e **Restaurar**.
- O tutor funciona no modo offline. A IA (Claude) e a nuvem da conta só funcionam quando o app é aberto pelo link do claude.ai.
