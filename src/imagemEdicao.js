// src/imagemEdicao.js (v0.50.0) — editar fotos como um editor profissional, com o ImageMagick do aparelho (sem IA,
// sem custo, offline). Uma receita, aplicada a uma foto ou a várias de uma vez (lote):
//   formato de cada rede (feed 4:5, quadrado, stories 9:16, capa do YouTube 16:9) com fundo desfocado, preenchendo ou
//   com barras; melhorar automático; cor pronta; brilho, contraste, saturação e nitidez; textos (com contorno ou faixa
//   de fundo, quebrados em linhas e empilhados); marca d'água; tamanho leve para WhatsApp; e tira a localização
//   (EXIF/GPS) por padrão, depois de endireitar a foto.
// As travas do src/imagem.js valem aqui: formato explícito em cada arquivo ("jpeg:foto.jpg"), entrada conferida por
// src/imagens.js (segredos, formato, tamanho) e saída sempre num arquivo novo fora das áreas protegidas. O texto vai
// como argumento (nunca por shell) e escapado: um "@" no começo leria um arquivo e "%w"/"%[fx:...]" seriam
// interpretados pelo ImageMagick.
'use strict';

const fs = require('fs');
const path = require('path');
const imagem = require('./imagem');

const FORMATOS = {
  feed: { w: 1080, h: 1350, nome: 'feed do Instagram (4:5, 1080x1350)' },
  quadrado: { w: 1080, h: 1080, nome: 'quadrado (1:1, 1080x1080)' },
  stories: { w: 1080, h: 1920, nome: 'Stories/Reels/Status (9:16, 1080x1920)' },
  youtube: { w: 1280, h: 720, nome: 'capa do YouTube (16:9, 1280x720)' },
};
const APELIDOS_FORMATO = {
  reels: 'stories', status: 'stories', tiktok: 'stories', vertical: 'stories', '9:16': 'stories',
  instagram: 'feed', '4:5': 'feed', '1:1': 'quadrado', capa: 'youtube', thumbnail: 'youtube', horizontal: 'youtube', '16:9': 'youtube',
};
const ENQUADRAMENTOS = ['fundo-desfocado', 'preencher', 'barras'];
const CORES = {
  natural: ['-modulate', '102,110', '-brightness-contrast', '1x4'],
  vivo: ['-modulate', '100,135', '-brightness-contrast', '0x12', '-unsharp', '0x1'],
  quente: ['-channel', 'R', '-evaluate', 'multiply', '1.06', '-channel', 'B', '-evaluate', 'multiply', '0.92', '+channel'],
  frio: ['-channel', 'R', '-evaluate', 'multiply', '0.94', '-channel', 'B', '-evaluate', 'multiply', '1.08', '+channel'],
  cinema: ['-channel', 'B', '-evaluate', 'multiply', '1.05', '+channel', '-brightness-contrast', '-3x14', '-modulate', '100,90'],
  pb: ['-modulate', '100,0', '-brightness-contrast', '0x12'],
  vintage: ['-sepia-tone', '70%', '-modulate', '100,80', '-brightness-contrast', '4x-6'],
  dramatico: ['-brightness-contrast', '-5x25', '-modulate', '100,110'],
};
const QUALIDADES = { alta: { q: 92 }, normal: { q: 86 }, leve: { q: 76, maxLado: 1600 } };
const POSICOES_TEXTO = { topo: 'north', centro: 'center', baixo: 'south' };
const TAMANHOS_TEXTO = { pequeno: 0.045, medio: 0.06, grande: 0.085 };
const GRAVIDADE_MARCA = {
  'canto-inferior-direito': 'southeast', 'canto-inferior-esquerdo': 'southwest', 'canto-superior-direito': 'northeast',
  'canto-superior-esquerdo': 'northwest', centro: 'center',
};
const IMAGENS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MAX_FOTOS = 50;
const MAX_TEXTOS = 10;

/** Texto para o -annotate: \ e % viram literais, e um "@" no começo não lê arquivo. */
function textoMagick(t) {
  const s = String(t).replace(/\\/g, '\\\\').replace(/%/g, '%%');
  return s.startsWith('@') ? `\\${s}` : s;
}

const numero = (v, rotulo, min, max) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${rotulo} precisa ficar entre ${min} e ${max}.`);
  return n;
};
const lista = (o) => Object.keys(o).join(', ');

/** Valida e normaliza a receita (os nomes são os da ferramenta "imagem", ação "ajustar"). */
function normalizarReceita(r = {}, { cwd = process.cwd() } = {}) {
  const tem = (k) => r[k] !== undefined && r[k] !== null && r[k] !== '';
  const x = { enquadrar: 'fundo-desfocado', qualidade: 'normal', tirarLocalizacao: r.manter_localizacao !== true, melhorar: r.melhorar === true };
  if (tem('formato') && String(r.formato).toLowerCase() !== 'original') {
    const f = String(r.formato).toLowerCase();
    x.formato = FORMATOS[f] ? f : APELIDOS_FORMATO[f];
    if (!x.formato) throw new Error(`formato desconhecido ("${r.formato}"). Use: ${lista(FORMATOS)} (ou reels, instagram, capa), ou original.`);
  }
  if (tem('enquadrar')) {
    if (!ENQUADRAMENTOS.includes(r.enquadrar)) throw new Error(`enquadrar: use ${ENQUADRAMENTOS.join(', ')}.`);
    x.enquadrar = r.enquadrar;
  }
  if (tem('cor') && r.cor !== 'nenhuma') {
    if (!CORES[r.cor]) throw new Error(`cor desconhecida ("${r.cor}"). Use: ${lista(CORES)} ou nenhuma.`);
    x.cor = r.cor;
  }
  if (tem('brilho')) x.brilho = numero(r.brilho, 'o brilho', -1, 1);
  if (tem('contraste')) x.contraste = numero(r.contraste, 'o contraste', 0, 3);
  if (tem('saturacao')) x.saturacao = numero(r.saturacao, 'a saturação', 0, 3);
  if (tem('nitidez')) x.nitidez = numero(r.nitidez, 'a nitidez', 0, 3);
  if (tem('qualidade')) {
    if (!QUALIDADES[r.qualidade]) throw new Error(`qualidade: use ${lista(QUALIDADES)}.`);
    x.qualidade = r.qualidade;
  }
  const textos = typeof r.textos === 'string' ? [{ texto: r.textos }] : (Array.isArray(r.textos) ? r.textos : []);
  if (textos.length > MAX_TEXTOS) throw new Error(`no máximo ${MAX_TEXTOS} textos por foto.`);
  x.textos = textos.map((t, i) => {
    const o = typeof t === 'string' ? { texto: t } : (t && typeof t === 'object' ? t : {});
    const texto = String(o.texto ?? '').trim();
    if (!texto) throw new Error(`o texto ${i + 1} está vazio.`);
    if (texto.length > 300) throw new Error(`o texto ${i + 1} passa de 300 caracteres.`);
    const posicao = o.posicao || 'baixo';
    if (!POSICOES_TEXTO[posicao]) throw new Error(`posição do texto ${i + 1}: use ${lista(POSICOES_TEXTO)}.`);
    const tamanho = o.tamanho || 'medio';
    if (!TAMANHOS_TEXTO[tamanho]) throw new Error(`tamanho do texto ${i + 1}: use ${lista(TAMANHOS_TEXTO)}.`);
    return { texto, posicao, tamanho, fundo: o.fundo === true };
  });
  if (tem('marca_dagua')) {
    x.marca = path.resolve(cwd, String(r.marca_dagua));
    require('./imagens').lerImagem(x.marca); // as mesmas travas da entrada
    if (!IMAGENS.has(path.extname(x.marca).toLowerCase())) throw new Error("a marca d'água precisa ser .png, .jpg ou .webp.");
    x.posicaoMarca = r.posicao_marca || 'canto-inferior-direito';
    if (!GRAVIDADE_MARCA[x.posicaoMarca]) throw new Error(`posição da marca d'água: use ${lista(GRAVIDADE_MARCA)}.`);
    x.tamanhoMarca = tem('tamanho_marca') ? numero(r.tamanho_marca, "o tamanho da marca d'água", 0.05, 0.5) : 0.18;
    x.opacidadeMarca = tem('opacidade_marca') ? numero(r.opacidade_marca, "a opacidade da marca d'água", 0.1, 1) : 0.85;
  }
  return x;
}

function quebrarLinhas(texto, max) {
  const saida = [];
  for (const paragrafo of String(texto).split(/\r?\n/)) {
    let linha = '';
    for (const palavra of paragrafo.split(/\s+/).filter(Boolean)) {
      if (linha && (linha.length + 1 + palavra.length) > max) { saida.push(linha); linha = palavra; } else linha = linha ? `${linha} ${palavra}` : palavra;
    }
    saida.push(linha);
  }
  return saida;
}

/**
 * Os argumentos do ImageMagick (puro). `w`/`h`: tamanho da foto de entrada, já endireitada.
 * @returns {{args: string[], largura: number, altura: number, passos: string[]}}
 */
function montarArgs(entrada, saida, x, { w, h, fonte = null, alturaMarca = 0 } = {}) {
  const coderIn = imagem.CODER[path.extname(entrada).toLowerCase()];
  const coderOut = imagem.CODER[path.extname(saida).toLowerCase()];
  if (!coderIn || !coderOut) throw new Error('use .png, .jpg, .webp ou .gif');
  const passos = [];
  const a = [`${coderIn}:${entrada}`, '-auto-orient'];
  if (x.melhorar) { a.push('-auto-level', '-modulate', '100,108', '-enhance', '-unsharp', '0x0.8+0.8+0.01'); passos.push('melhorada (luz, cor e nitidez)'); }
  if (x.cor) { a.push(...CORES[x.cor]); passos.push(`cor "${x.cor}"`); }
  if (x.brilho !== undefined || x.contraste !== undefined) {
    const b = Math.round((x.brilho || 0) * 40);
    const c = Math.max(-100, Math.min(100, Math.round(((x.contraste ?? 1) - 1) * 40)));
    a.push('-brightness-contrast', `${b}x${c}`);
    passos.push('brilho/contraste');
  }
  if (x.saturacao !== undefined) { a.push('-modulate', `100,${Math.round(x.saturacao * 100)}`); passos.push('saturação'); }
  if (x.nitidez) { a.push('-unsharp', `0x1+${x.nitidez}+0.02`); passos.push('nitidez'); }
  let W = w;
  let H = h;
  if (x.formato) {
    ({ w: W, h: H } = FORMATOS[x.formato]);
    if (x.enquadrar === 'preencher') a.push('-resize', `${W}x${H}^`, '-gravity', 'center', '-extent', `${W}x${H}`);
    else if (x.enquadrar === 'barras') a.push('-resize', `${W}x${H}`, '-gravity', 'center', '-background', 'white', '-extent', `${W}x${H}`);
    else {
      // fundo desfocado: a própria foto, ampliada e desfocada atrás (o desfoque em 1/10 do tamanho é rápido)
      a.push('(', '-clone', '0', '-resize', `${W}x${H}^`, '-gravity', 'center', '-extent', `${W}x${H}`, '-scale', '10%', '-blur', '0x2',
        '-resize', `${W}x${H}!`, '-modulate', '94,90', ')', '(', '-clone', '0', '-resize', `${W}x${H}`, ')', '-delete', '0',
        '-gravity', 'center', '-composite');
    }
    passos.push(`formato ${FORMATOS[x.formato].nome}${x.enquadrar === 'fundo-desfocado' ? ' com fundo desfocado' : x.enquadrar === 'barras' ? ' com barras' : ', preenchendo'}`);
  }
  const max = QUALIDADES[x.qualidade].maxLado;
  if (!x.formato && max && Math.max(W, H) > max) {
    const f = max / Math.max(W, H);
    W = Math.round(W * f);
    H = Math.round(H * f);
    a.push('-resize', `${max}x${max}>`);
    passos.push(`reduzida para ${W}x${H}`);
  }
  // textos: agrupados por posição; os da mesma posição ficam empilhados, na ordem dada
  const base = Math.min(W, H);
  const margem = Math.round(H * 0.06);
  // a marca d'água num canto de baixo (ou de cima) empurra o texto daquele lado, para não ficar um em cima do outro
  const livre = (lado) => (x.marca && alturaMarca && x.posicaoMarca.includes(lado) ? Math.max(margem, alturaMarca + Math.round(base * 0.06)) : margem);
  for (const [posicao, gravidade] of Object.entries(POSICOES_TEXTO)) {
    const itens = x.textos.filter((t) => t.posicao === posicao).map((t) => {
      const tam = Math.round(base * TAMANHOS_TEXTO[t.tamanho]);
      const linhas = quebrarLinhas(t.texto, Math.max(6, Math.floor((W * 0.86) / (tam * 0.6))));
      return { t, tam, linhas, altura: Math.round(linhas.length * tam * 1.25) };
    });
    if (!itens.length) continue;
    const vao = Math.round(base * 0.02);
    const total = itens.reduce((s, o) => s + o.altura, 0) + vao * (itens.length - 1);
    let y = posicao === 'centro' ? -Math.round(total / 2) : livre(posicao === 'baixo' ? 'inferior' : 'superior');
    const ordem = posicao === 'baixo' ? [...itens].reverse() : itens; // em baixo, empilha de baixo para cima
    for (const o of ordem) {
      const off = posicao === 'centro' ? y + Math.round(o.altura / 2) : y;
      const geo = `+0${off < 0 ? '-' : '+'}${Math.abs(off)}`;
      const texto = textoMagick(o.linhas.join('\n'));
      a.push('-gravity', gravidade, '-pointsize', String(o.tam), ...(fonte ? ['-font', fonte] : []), '-interline-spacing', String(Math.round(o.tam * 0.12)));
      if (o.t.fundo) a.push('-undercolor', 'rgba(0,0,0,0.5)');
      a.push('-fill', 'white', '-stroke', 'black', '-strokewidth', String(Math.max(2, Math.round(o.tam * 0.07))), '-annotate', geo, texto);
      a.push('-stroke', 'none', '-undercolor', 'none', '-annotate', geo, texto);
      y += o.altura + vao;
    }
  }
  if (x.textos.length) passos.push(x.textos.length === 1 ? 'texto' : `${x.textos.length} textos`);
  if (x.marca) {
    const coderMarca = imagem.CODER[path.extname(x.marca).toLowerCase()];
    const m = Math.round(base * 0.03);
    a.push('(', `${coderMarca}:${x.marca}`, '-resize', `${Math.round(W * x.tamanhoMarca)}x`, '-alpha', 'set', '-channel', 'A', '-evaluate', 'multiply', String(x.opacidadeMarca), '+channel', ')',
      '-gravity', GRAVIDADE_MARCA[x.posicaoMarca], '-geometry', x.posicaoMarca === 'centro' ? '+0+0' : `+${m}+${m}`, '-composite');
    passos.push("marca d'água");
  }
  if (x.tirarLocalizacao) { a.push('-strip'); passos.push('sem a localização e os dados da câmera (EXIF)'); }
  a.push('-quality', String(QUALIDADES[x.qualidade].q), `${coderOut}:${saida}`);
  return { args: a, largura: W, altura: H, passos };
}

/** Largura e altura da foto já endireitada (a orientação do EXIF conta). */
async function medidas(magick, arquivo) {
  const coder = imagem.CODER[path.extname(arquivo).toLowerCase()];
  const { stdout } = await imagem.rodar(magick, [`${coder}:${arquivo}`, '-auto-orient', '-format', '%w %h', 'info:']);
  const [w, h] = String(stdout).trim().split(/\s+/).map(Number);
  if (!w || !h) throw new Error('não consegui ler o tamanho da foto.');
  return { w, h };
}

/** Edita uma foto (ou várias, em lote) com a receita. @returns {Promise<{arquivos: Array<{arquivo, largura, altura}>, passos}>} */
async function ajustar(fotos, receita = {}, { saida, cwd = process.cwd(), magick = imagem.acharMagick() } = {}) {
  if (!magick) throw new Error('para editar fotos sem IA, instale o ImageMagick (Termux: pkg install imagemagick; Debian/Ubuntu: sudo apt install imagemagick).');
  const lista_ = (Array.isArray(fotos) ? fotos : [fotos]).filter((f) => typeof f === 'string' && f.trim());
  if (!lista_.length) throw new Error('informe a foto.');
  if (lista_.length > MAX_FOTOS) throw new Error(`no máximo ${MAX_FOTOS} fotos por vez.`);
  if (saida && lista_.length > 1) throw new Error('com várias fotos, não use "saida": cada uma vira <nome>-editada ao lado da original.');
  const x = normalizarReceita(receita, { cwd });
  const { acharFonte } = require('./videoEdicao');
  const fonte = x.textos.length ? acharFonte() : null;
  const feitos = [];
  let passos = [];
  const logo = x.marca ? await medidas(magick, x.marca) : null;
  for (const f of lista_) {
    const entrada = path.resolve(cwd, f);
    require('./imagens').lerImagem(entrada); // segredos, formato, tamanho
    const extIn = path.extname(entrada).toLowerCase();
    const ext = extIn === '.gif' ? '.png' : (extIn === '.jpeg' ? '.jpg' : extIn);
    const destino = imagem.destinoNovo({ saida, base: entrada, sufixo: '-editada', ext, cwd });
    const { w, h } = await medidas(magick, entrada);
    const larguraFinal = x.formato ? FORMATOS[x.formato].w : w;
    const alturaMarca = logo ? Math.round((larguraFinal * x.tamanhoMarca * logo.h) / logo.w) : 0;
    const plano = montarArgs(entrada, destino, x, { w, h, fonte, alturaMarca });
    await imagem.rodar(magick, plano.args);
    if (!fs.existsSync(destino)) throw new Error('o ImageMagick terminou sem criar a foto.');
    feitos.push({ arquivo: destino, largura: plano.largura, altura: plano.altura });
    passos = plano.passos;
  }
  return { arquivos: feitos, passos };
}

module.exports = {
  FORMATOS, APELIDOS_FORMATO, ENQUADRAMENTOS, CORES, QUALIDADES, POSICOES_TEXTO, TAMANHOS_TEXTO, GRAVIDADE_MARCA,
  textoMagick, normalizarReceita, quebrarLinhas, montarArgs, medidas, ajustar,
};
