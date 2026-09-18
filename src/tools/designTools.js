// src/tools/designTools.js
// "gemini-code design" — slides, docs e imagens, no espírito do que o
// usuário chamou de "Gemini Design".
'use strict';

const fs = require('fs');
const path = require('path');
const { generateText, generateImage } = require('../gemini');

async function makeSlides(prompt, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const outline = await generateText({
    prompt:
      `Crie o conteúdo de uma apresentação de slides sobre: "${prompt}".\n` +
      'Responda em Markdown, um slide por seção, cada slide começando com "## ".\n' +
      'De 6 a 10 slides, com título, texto curto (bullets) e sugestão de imagem entre colchetes.',
  });

  const slides = outline
    .split(/\n(?=##\s)/)
    .map((s) => s.trim())
    .filter((s) => s.startsWith('##')); // ignora preâmbulo que o modelo às vezes escreve antes do 1º slide

  const html = buildSlidesHtml(slides);
  const htmlPath = path.join(outDir, 'apresentacao.html');
  const mdPath = path.join(outDir, 'apresentacao.md');
  fs.writeFileSync(htmlPath, html, 'utf8');
  fs.writeFileSync(mdPath, outline, 'utf8');
  return { htmlPath, mdPath, slideCount: slides.length };
}

function buildSlidesHtml(slides) {
  const body = slides
    .map(
      (s, i) => `<section class="slide" data-index="${i}">${mdToHtml(s)}</section>`
    )
    .join('\n');
  return `<!doctype html>
<html lang="pt-br">
<head>
<meta charset="utf-8" />
<title>Apresentação gerada pelo gemini-code</title>
<style>
  body { margin:0; font-family: system-ui, sans-serif; background:#111; color:#eee; }
  .slide { display:none; min-height:100vh; box-sizing:border-box; padding:8vh 8vw; }
  .slide.active { display:flex; flex-direction:column; justify-content:center; }
  .slide h2 { font-size: 2.4rem; margin-bottom: 1rem; }
  .nav { position:fixed; bottom:1rem; right:1rem; }
  button { padding:.6rem 1rem; margin-left:.5rem; }
</style>
</head>
<body>
${body}
<div class="nav">
  <button onclick="go(-1)">‹ Anterior</button>
  <button onclick="go(1)">Próximo ›</button>
</div>
<script>
  let i = 0;
  const slides = document.querySelectorAll('.slide');
  function render() { slides.forEach((s, idx) => s.classList.toggle('active', idx === i)); }
  function go(delta) { i = Math.max(0, Math.min(slides.length - 1, i + delta)); render(); }
  render();
</script>
</body>
</html>`;
}

function escapeHtml(text) {
  // Antes o texto gerado pelo modelo ia direto pro HTML sem escapar nada:
  // qualquer "<", ">" ou "&" no conteúdo (comum em slides sobre programação,
  // ex. "use `<script>`" ou "A && B") quebrava a tag/estrutura da página
  // gerada, às vezes cortando o resto do slide.
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function mdToHtml(md) {
  const linhas = md.replace(/^##\s+(.*)$/m, (_, titulo) => `<h2>${escapeHtml(titulo)}</h2>`).split('\n');

  // Antes, linhas de bullet viravam <li> soltos, sem um <ul> em volta —
  // HTML inválido: sem a lista-mãe, o navegador não aplica o recuo/marcador
  // padrão e a lista aparecia toda desalinhada. Agora agrupa sequências de
  // "- item" num único <ul>...</ul>.
  const out = [];
  let emLista = false;
  for (const line of linhas) {
    const t = line.trim();
    if (t.startsWith('- ')) {
      if (!emLista) { out.push('<ul>'); emLista = true; }
      out.push(`<li>${escapeHtml(t.slice(2))}</li>`);
      continue;
    }
    if (emLista) { out.push('</ul>'); emLista = false; }
    if (!t || t.startsWith('<h2>')) out.push(t);
    else out.push(`<p>${escapeHtml(t)}</p>`);
  }
  if (emLista) out.push('</ul>');
  return out.join('\n');
}

async function makeDoc(prompt, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const content = await generateText({
    prompt: `Escreva um documento completo e bem estruturado (Markdown, com títulos e seções) sobre: "${prompt}".`,
  });
  const outPath = path.join(outDir, 'documento.md');
  fs.writeFileSync(outPath, content, 'utf8');
  return { outPath };
}

async function makeImage(prompt, outDir, fileName = 'imagem.png') {
  fs.mkdirSync(outDir, { recursive: true });
  const image = await generateImage({ prompt });
  const outPath = path.join(outDir, fileName);
  fs.writeFileSync(outPath, Buffer.from(image.data, 'base64'));
  return { outPath, mimeType: image.mimeType };
}

module.exports = { makeSlides, makeDoc, makeImage };
