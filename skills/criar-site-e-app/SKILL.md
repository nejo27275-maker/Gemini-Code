---
name: criar-site-e-app
description: >
  Cria e personaliza sites e apps (PWA que instala no celular e funciona offline) a partir de um ponto de partida
  pronto, com qualidade: responsivo, acessível, modo escuro e testado no navegador. Use quando o usuário pedir um
  site, uma página, uma landing page ou um app simples.
version: 1.0.0
---

# Skill: criar site e app

## Quando usar

O usuário pede "faz um site da minha padaria", "um app para anotar meus gastos", "uma página de convite". Para um
sistema grande (login, banco de dados, pagamentos), combine o escopo antes e avise o que precisa de servidor.

## Passo a passo

1. **Comece do ponto de partida** (sem IA, já testado): peça ao usuário para rodar, ou rode com `run_shell`:
   - site: `gemini-code criar site NOME --titulo "..." --descricao "..."`
   - app (PWA): `gemini-code criar app NOME --titulo "..."`
   Os arquivos ficam em `./NOME` (index.html, style.css, script.js/app.js; no app também manifest, service worker e ícone).
2. **Personalize editando os arquivos** (`edit_file`): textos reais do usuário (nunca invente telefone, endereço ou
   preço — pergunte), cores (as variáveis `--destaque`, `--fundo` em `style.css`), seções.
3. **Regras de qualidade**
   - Mobile primeiro: teste mentalmente em 360 px; nada de largura fixa; imagens com `max-width: 100%`.
   - Acessível: um `h1` por página, `alt` em toda imagem, contraste bom, botões de verdade (`<button>`), foco visível.
   - Seguro: texto digitado pelo usuário entra com `textContent`, nunca `innerHTML`; nenhum segredo (chave de API,
     senha) no código do navegador — tudo ali é público.
   - Leve: sem bibliotecas desnecessárias; nada carregado de fora sem motivo.
   - PWA: ao mudar arquivos, aumente `VERSAO` no `sw.js` (senão o celular continua com a versão antiga em cache) e
     mantenha a lista `ARQUIVOS` atualizada.
4. **Teste no navegador**: `gemini-code criar servir NOME` (http://127.0.0.1:8080) e, se a ferramenta `browser`
   estiver disponível com `navegadorPermitirLocal` ligado, abra a página, clique e confira; senão peça ao usuário
   para abrir no celular.
5. **Publicar** (o usuário decide): GitHub Pages ou Netlify Drop (gratuitos, https — necessário para instalar o PWA).
   Nunca publique nada sem o usuário pedir.

## Ao terminar

Diga onde estão os arquivos, como ver (`gemini-code criar servir NOME`) e o que ainda depende do usuário (textos,
fotos, domínio).
