// src/videoEdicao.js (v0.50.0) — editar vídeo como um editor profissional, com o ffmpeg do aparelho (sem IA, sem custo)
//   editar  uma receita numa passada só: cortar, velocidade, estabilizar, melhorar, cor, formato de cada rede (fundo
//           desfocado, preencher ou barras), legenda .srt queimada, textos na tela, fade, marca d'água, música com a
//           voz por cima (a música abaixa sozinha quando alguém fala) e o áudio no volume das redes (-14 LUFS)
//   juntar  vários clipes num vídeo só (mesmo tamanho e ritmo; com ou sem transição suave)
//   capa    a melhor imagem do vídeo (ou a de um instante), em .jpg, para a capa do post
//   audio   só o áudio, em .mp3 (ou .m4a)
//   info    duração, tamanho, áudio, quadros por segundo e rotação
// As travas do src/video.js valem aqui: entradas "file:" com -protocol_whitelist file, saída sempre num arquivo novo
// (-n), fora das áreas protegidas. Texto e legenda vão por arquivo temporário (textfile/subtitles) e o drawtext roda
// com expansion=none: o texto da pessoa (ou do modelo) nunca vira parte do filtro, e um "%{...}" aparece como está.
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const video = require('./video');

const FORMATOS = {
  reels: { w: 1080, h: 1920, nome: 'Reels/TikTok/Shorts/Stories (9:16, 1080x1920)' },
  feed: { w: 1080, h: 1350, nome: 'feed do Instagram (4:5, 1080x1350)' },
  quadrado: { w: 1080, h: 1080, nome: 'quadrado (1:1, 1080x1080)' },
  youtube: { w: 1920, h: 1080, nome: 'YouTube/horizontal (16:9, 1920x1080)' },
};
const APELIDOS_FORMATO = {
  tiktok: 'reels', shorts: 'reels', stories: 'reels', status: 'reels', vertical: 'reels', '9:16': 'reels',
  instagram: 'feed', '4:5': 'feed', '1:1': 'quadrado', horizontal: 'youtube', '16:9': 'youtube',
};
const ENQUADRAMENTOS = ['fundo-desfocado', 'preencher', 'barras'];
const CORES = {
  natural: 'eq=contrast=1.05:saturation=1.1:brightness=0.01',
  vivo: 'eq=contrast=1.12:saturation=1.35,unsharp=5:5:0.4:5:5:0.0',
  quente: 'colorbalance=rs=0.08:gs=0.02:bs=-0.08:rm=0.05:bm=-0.05,eq=saturation=1.08',
  frio: 'colorbalance=rs=-0.06:bs=0.08:rm=-0.04:bm=0.06',
  cinema: 'colorbalance=rs=-0.05:gs=-0.02:bs=0.08:rh=0.08:gh=0.02:bh=-0.06,eq=contrast=1.08:saturation=0.95,vignette=PI/5',
  pb: 'hue=s=0,eq=contrast=1.12',
  vintage: 'curves=preset=vintage,vignette=PI/4',
  dramatico: 'eq=contrast=1.25:saturation=1.1:gamma=0.95,vignette=PI/4',
};
const QUALIDADES = {
  alta: { crf: 18, audio: '192k' },
  normal: { crf: 21, audio: '160k' },
  leve: { crf: 27, audio: '96k', maxAltura: 720 }, // WhatsApp e internet fraca
};
const POSICOES_TEXTO = ['topo', 'centro', 'baixo'];
// fração do MENOR lado do vídeo (1080 num Reels ou num 16:9): 49, 65 e 86 px
const TAMANHOS_TEXTO = { pequeno: 0.045, medio: 0.06, grande: 0.08 };
const LARGURA_CARACTERE = 0.62; // largura média de um caractere (fonte sem serifa, negrito) em relação ao tamanho
const ALTURA_LINHA = 1.3;
const POSICOES_MARCA = {
  'canto-inferior-direito': ['W-w-M', 'H-h-M'], 'canto-inferior-esquerdo': ['M', 'H-h-M'],
  'canto-superior-direito': ['W-w-M', 'M'], 'canto-superior-esquerdo': ['M', 'M'], centro: ['(W-w)/2', '(H-h)/2'],
};
const LEGENDAS = new Set(['.srt', '.vtt', '.ass']);
const IMAGENS = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const MAX_TEXTOS = 10;
const MAX_CLIPES = 20;
const MAX_LEGENDA_BYTES = 2 * 1024 * 1024;
const FONTES = [
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', '/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
  '/usr/share/fonts/dejavu/DejaVuSans-Bold.ttf', '/data/data/com.termux/files/usr/share/fonts/TTF/DejaVuSans-Bold.ttf',
  '/system/fonts/Roboto-Bold.ttf', '/system/fonts/Roboto-Regular.ttf',
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf', '/Library/Fonts/Arial Bold.ttf',
];

// ---------------------------------------------------------------------------
// Peças puras
// ---------------------------------------------------------------------------
/** Valor de opção dentro de um filtro do ffmpeg: os dois níveis de escape (opção e filtergraph). */
function escaparValor(v) {
  return String(v).replace(/[\\':]/g, '\\$&').replace(/[\\'[\],;]/g, '\\$&');
}

/** "75", "75.5", "1:15", "01:02:03.5" -> segundos. */
function lerTempo(v, rotulo = 'o tempo') {
  if (typeof v === 'number') {
    if (Number.isFinite(v) && v >= 0) return v;
    throw new Error(`${rotulo} precisa ser um número de segundos (0 ou mais).`);
  }
  const partes = String(v ?? '').trim().replace(',', '.').split(':');
  if (partes.length > 3 || partes.some((p) => !/^\d+(\.\d+)?$/.test(p)) || partes.slice(0, -1).some((p) => p.includes('.'))) {
    throw new Error(`${rotulo} é inválido ("${v}"): use segundos (75), mm:ss (1:15) ou hh:mm:ss.`);
  }
  const nums = partes.map(Number);
  if (nums.slice(1).some((n) => n >= 60)) throw new Error(`${rotulo} é inválido ("${v}"): minutos e segundos vão até 59.`);
  return nums.reduce((acc, n) => acc * 60 + n, 0);
}

/** "0:05-0:35", "5 a 35", "0:05 até 0:35" -> { inicio, fim }. */
function lerCorte(v) {
  const partes = String(v || '').trim().split(/\s*(?:–|—|\s-\s|-|\s+a\s+|\s+até\s+)\s*/);
  if (partes.length !== 2 || !partes[0] || !partes[1]) throw new Error(`o corte é inválido ("${v}"): use INICIO-FIM, por exemplo 0:05-0:35.`);
  const inicio = lerTempo(partes[0], 'o início do corte');
  const fim = lerTempo(partes[1], 'o fim do corte');
  if (fim <= inicio) throw new Error('o fim do corte precisa vir depois do início.');
  return { inicio, fim };
}

/** O atempo aceita de 0,5 a 2 por vez: 4x vira 2 x 2; 0,3x vira 0,5 x 0,6. */
function cadeiaAtempo(fator) {
  const lista = [];
  let f = fator;
  while (f > 2) { lista.push(2); f /= 2; }
  while (f < 0.5) { lista.push(0.5); f /= 0.5; }
  if (Math.abs(f - 1) > 1e-9 || !lista.length) lista.push(Number(f.toFixed(6)));
  return lista;
}

const fmt = (s) => Number(s).toFixed(3).replace(/\.?0+$/, '') || '0';
const par = (n) => Math.max(2, 2 * Math.round(n / 2));
const numero = (v, rotulo, min, max) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${rotulo} precisa ficar entre ${min} e ${max}.`);
  return n;
};
const lista = (o) => Object.keys(o).join(', ');

/** Quebra o texto em linhas de até `max` caracteres (o drawtext não quebra sozinho). */
function quebrarLinhas(texto, max) {
  const saida = [];
  for (const paragrafo of String(texto).split(/\r?\n/)) {
    let linha = '';
    for (const palavra of paragrafo.split(/\s+/).filter(Boolean)) {
      if (linha && (linha.length + 1 + palavra.length) > max) { saida.push(linha); linha = palavra; } else linha = linha ? `${linha} ${palavra}` : palavra;
    }
    saida.push(linha);
  }
  return saida.join('\n');
}

function conferirArquivo(arquivo, tipos, rotulo, cwd) {
  return video.conferirEntrada(path.resolve(cwd, String(arquivo || '')), tipos, rotulo);
}

/**
 * Valida e normaliza a receita (os nomes são os da ferramenta "video"). Lança Error com a explicação em português.
 * Caminhos de arquivo voltam absolutos e conferidos (existem, formato certo, não são segredo do gemini-code).
 */
function normalizarReceita(r = {}, { cwd = process.cwd() } = {}) {
  const x = { normalizar: r.normalizar !== false, qualidade: 'normal', velocidade: 1 };
  const tem = (k) => r[k] !== undefined && r[k] !== null && r[k] !== '';
  if (tem('cortar')) Object.assign(x, lerCorte(r.cortar));
  if (tem('inicio')) x.inicio = lerTempo(r.inicio, 'o início');
  if (tem('fim')) x.fim = lerTempo(r.fim, 'o fim');
  if (x.fim !== undefined && x.fim <= (x.inicio || 0)) throw new Error('o fim do corte precisa vir depois do início.');
  if (tem('velocidade')) x.velocidade = numero(r.velocidade, 'a velocidade', 0.25, 4);
  if (tem('formato') && String(r.formato).toLowerCase() !== 'original') {
    const f = String(r.formato).toLowerCase();
    x.formato = FORMATOS[f] ? f : APELIDOS_FORMATO[f];
    if (!x.formato) throw new Error(`formato desconhecido ("${r.formato}"). Use: ${lista(FORMATOS)} (ou tiktok, shorts, stories, instagram, horizontal), ou original.`);
  }
  x.enquadrar = 'fundo-desfocado';
  if (tem('enquadrar')) {
    if (!ENQUADRAMENTOS.includes(r.enquadrar)) throw new Error(`enquadrar: use ${ENQUADRAMENTOS.join(', ')}.`);
    x.enquadrar = r.enquadrar;
  }
  if (tem('cor') && r.cor !== 'nenhuma') {
    if (!CORES[r.cor]) throw new Error(`cor desconhecida ("${r.cor}"). Use: ${lista(CORES)} ou nenhuma.`);
    x.cor = r.cor;
  }
  if (tem('brilho') || tem('contraste') || tem('saturacao')) {
    x.ajustes = {
      brilho: tem('brilho') ? numero(r.brilho, 'o brilho', -1, 1) : 0,
      contraste: tem('contraste') ? numero(r.contraste, 'o contraste', 0, 3) : 1,
      saturacao: tem('saturacao') ? numero(r.saturacao, 'a saturação', 0, 3) : 1,
    };
  }
  x.estabilizar = r.estabilizar === true;
  x.melhorar = r.melhorar === true;
  if (tem('fade') && r.fade !== false) x.fade = r.fade === true ? 0.5 : numero(r.fade, 'o fade', 0.1, 5);
  if (tem('qualidade')) {
    if (!QUALIDADES[r.qualidade]) throw new Error(`qualidade: use ${lista(QUALIDADES)}.`);
    x.qualidade = r.qualidade;
  }
  const textos = typeof r.textos === 'string' ? [{ texto: r.textos }] : (Array.isArray(r.textos) ? r.textos : []);
  if (textos.length > MAX_TEXTOS) throw new Error(`no máximo ${MAX_TEXTOS} textos por vídeo.`);
  x.textos = textos.map((t, i) => {
    const o = typeof t === 'string' ? { texto: t } : (t && typeof t === 'object' ? t : {});
    const texto = String(o.texto ?? '').trim();
    if (!texto) throw new Error(`o texto ${i + 1} está vazio.`);
    if (texto.length > 300) throw new Error(`o texto ${i + 1} passa de 300 caracteres (use legenda para falas longas).`);
    const posicao = o.posicao || 'baixo';
    if (!POSICOES_TEXTO.includes(posicao)) throw new Error(`posição do texto ${i + 1}: use ${POSICOES_TEXTO.join(', ')}.`);
    const tamanho = o.tamanho || 'medio';
    if (!TAMANHOS_TEXTO[tamanho]) throw new Error(`tamanho do texto ${i + 1}: use ${lista(TAMANHOS_TEXTO)}.`);
    const inicio = o.inicio !== undefined && o.inicio !== null && o.inicio !== '' ? lerTempo(o.inicio, `o início do texto ${i + 1}`) : null;
    const fim = o.fim !== undefined && o.fim !== null && o.fim !== '' ? lerTempo(o.fim, `o fim do texto ${i + 1}`) : null;
    if (inicio !== null && fim !== null && fim <= inicio) throw new Error(`o texto ${i + 1} termina antes de começar.`);
    return { texto, posicao, tamanho, inicio, fim, fundo: o.fundo === true };
  });
  if (tem('legenda')) {
    x.legenda = conferirArquivo(r.legenda, LEGENDAS, 'a legenda', cwd);
    if (fs.statSync(x.legenda).size > MAX_LEGENDA_BYTES) throw new Error('a legenda passa de 2 MB.');
  }
  if (tem('musica')) {
    x.musica = conferirArquivo(r.musica, video.AUDIOS, 'a música', cwd);
    x.volumeMusica = tem('volume_musica') ? numero(r.volume_musica, 'o volume da música', 0.02, 1) : 0.25;
    x.abaixarMusica = r.abaixar_musica !== false;
  }
  if (tem('marca_dagua')) {
    x.marca = conferirArquivo(r.marca_dagua, IMAGENS, "a marca d'água", cwd);
    x.posicaoMarca = r.posicao_marca || 'canto-inferior-direito';
    if (!POSICOES_MARCA[x.posicaoMarca]) throw new Error(`posição da marca d'água: use ${lista(POSICOES_MARCA)}.`);
    x.tamanhoMarca = tem('tamanho_marca') ? numero(r.tamanho_marca, "o tamanho da marca d'água", 0.05, 0.5) : 0.18;
    x.opacidadeMarca = tem('opacidade_marca') ? numero(r.opacidade_marca, "a opacidade da marca d'água", 0.1, 1) : 0.85;
  }
  return x;
}

/**
 * HDR -> SDR (BT.709), como um editor faz ao exportar para as redes: sem isso, um vídeo HDR do celular sai em 8 bits
 * ainda marcado como HDR, e o Instagram/WhatsApp mostram as cores desbotadas. Precisa do filtro zscale.
 */
function cadeiaSdr(hdr) {
  const curva = hdr === 'pq' ? 'smpte2084' : 'arib-std-b67';
  return `zscale=tin=${curva}:pin=bt2020:min=bt2020nc:t=linear:npl=100,format=gbrpf32le,zscale=p=bt709,` +
    'tonemap=tonemap=hable:desat=0,zscale=t=bt709:m=bt709:r=tv,format=yuv420p';
}
const MARCAS_SDR = ['-color_primaries', 'bt709', '-color_trc', 'bt709', '-colorspace', 'bt709'];

/** Tamanho final: o do formato; sem formato, o do vídeo (pares; no máximo 720 de altura na qualidade "leve"). */
function tamanhoFinal(inf, x) {
  if (x.formato) return { w: FORMATOS[x.formato].w, h: FORMATOS[x.formato].h };
  let w = inf.largura;
  let h = inf.altura;
  const max = QUALIDADES[x.qualidade || 'normal'].maxAltura;
  if (max && h > max) { w = (w * max) / h; h = max; }
  return { w: par(w), h: par(h) };
}

/** Enquadra [entrada] em W x H e entrega [saida] (fundo desfocado, preencher ou barras). */
function geometria(entrada, saida, w, h, enquadrar, rotulo = 'g') {
  if (enquadrar === 'preencher') return `[${entrada}]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},setsar=1[${saida}]`;
  if (enquadrar === 'barras') return `[${entrada}]scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[${saida}]`;
  return [
    `[${entrada}]split=2[${rotulo}f0][${rotulo}p0]`,
    `[${rotulo}f0]scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h},gblur=sigma=40,eq=brightness=-0.06:saturation=0.9[${rotulo}f]`,
    `[${rotulo}p0]scale=${w}:${h}:force_original_aspect_ratio=decrease[${rotulo}p]`,
    `[${rotulo}f][${rotulo}p]overlay=(W-w)/2:(H-h)/2,setsar=1[${saida}]`,
  ].join(';');
}

/** Tamanho da fonte (px) de um texto e quantos caracteres cabem por linha, com margem de 7% de cada lado. */
function medidasTexto(w, h, tamanho) {
  const tam = Math.round(Math.min(w, h) * TAMANHOS_TEXTO[tamanho]);
  return { tam, porLinha: Math.max(6, Math.floor((w * 0.86) / (tam * LARGURA_CARACTERE))) };
}

/**
 * O y (topo) de cada texto. Na mesma posição, textos que aparecem AO MESMO TEMPO ficam empilhados (um abaixo do
 * outro, na ordem dada); os que aparecem em tempos diferentes usam o mesmo lugar. "topo" fica abaixo da faixa de
 * cima; "baixo", acima da legenda (se houver) e da faixa de baixo que o app da rede cobre.
 */
function posicionarTextos(textos, textosArquivos, w, h, { legenda = false } = {}) {
  const ys = new Array(textos.length).fill(0);
  const sobrepoe = (a, b) => (a.inicio ?? 0) < (b.fim ?? Infinity) && (b.inicio ?? 0) < (a.fim ?? Infinity);
  for (const posicao of POSICOES_TEXTO) {
    const itens = textos.map((t, i) => ({ t, i })).filter((o) => o.t.posicao === posicao);
    if (!itens.length) continue;
    const faixas = []; // cada faixa: textos que nunca aparecem juntos
    for (const o of itens) {
      const { tam } = medidasTexto(w, h, o.t.tamanho);
      o.altura = [].concat(textosArquivos[o.i] || []).length * Math.round(tam * ALTURA_LINHA);
      const faixa = faixas.find((f) => f.itens.every((p) => !sobrepoe(p.t, o.t)));
      if (faixa) { faixa.itens.push(o); faixa.altura = Math.max(faixa.altura, o.altura); } else faixas.push({ itens: [o], altura: o.altura });
    }
    const vao = Math.round(Math.min(w, h) * 0.02);
    const total = faixas.reduce((s, f) => s + f.altura, 0) + vao * (faixas.length - 1);
    let y = posicao === 'topo' ? Math.round(h * 0.1) : posicao === 'centro' ? Math.round((h - total) / 2) : Math.round(h * (legenda ? 0.7 : 0.8)) - total;
    for (const f of faixas) {
      for (const o of f.itens) ys[o.i] = Math.max(0, y);
      y += f.altura + vao;
    }
  }
  return ys;
}

/**
 * O plano do ffmpeg para a receita (puro). `extras`: os arquivos temporários de cada linha de cada texto (o drawtext
 * não centraliza linha por linha nem quebra sozinho, então cada linha é um texto centralizado), a legenda, a fonte e o
 * índice das entradas de música e marca d'água.
 * @returns {{filtro: string, temAudio: boolean, duracao: number|null, largura: number, altura: number, passos: string[]}}
 */
function montarEdicao(inf, x, { textosArquivos = [], legenda = null, legendaEstilo = true, fonte = null, entradaMusica = null, entradaMarca = null, converterHdr = false } = {}) {
  const passos = [];
  const vel = x.velocidade || 1;
  const ini = x.inicio || 0;
  const fimOrigem = x.fim !== undefined ? (inf.duracao ? Math.min(x.fim, inf.duracao) : x.fim) : inf.duracao;
  const duracao = fimOrigem ? Math.max(0, fimOrigem - ini) / vel : null;
  const { w, h } = tamanhoFinal(inf, x);
  const vertical = h > w;
  const cadeia = [];
  if (inf.hdr && converterHdr) { cadeia.push(cadeiaSdr(inf.hdr)); passos.push(`HDR (${inf.hdr.toUpperCase()}) convertido para cores normais (SDR)`); }
  else if (inf.hdr) passos.push(`ATENÇÃO: o vídeo é HDR (${inf.hdr.toUpperCase()}) e este ffmpeg não tem o filtro zscale para converter; as cores podem ficar desbotadas`);
  if (x.inicio || x.fim !== undefined) passos.push(`cortado de ${fmt(ini)} s a ${fimOrigem ? `${fmt(fimOrigem)} s` : 'o fim'}`);
  if (vel !== 1) { cadeia.push(`setpts=PTS/${fmt(vel)}`); passos.push(`velocidade ${String(fmt(vel)).replace('.', ',')}x`); }
  if (x.estabilizar) { cadeia.push('deshake'); passos.push('estabilizado'); }
  if (x.melhorar) { cadeia.push('hqdn3d=1.5:1.5:6:6', 'unsharp=5:5:0.6:5:5:0.0'); passos.push('menos ruído e mais nitidez'); }
  if (x.cor) { cadeia.push(CORES[x.cor]); passos.push(`cor "${x.cor}"`); }
  if (x.ajustes) {
    const a = x.ajustes;
    cadeia.push(`eq=brightness=${fmt(a.brilho)}:contrast=${fmt(a.contraste)}:saturation=${fmt(a.saturacao)}`);
    passos.push('brilho/contraste/saturação ajustados');
  }
  const partes = [`[0:v]${cadeia.length ? cadeia.join(',') : 'null'}[base]`];
  if (x.formato) {
    partes.push(geometria('base', 'geo', w, h, x.enquadrar));
    passos.push(`formato ${FORMATOS[x.formato].nome}${x.enquadrar === 'fundo-desfocado' ? ' com fundo desfocado' : x.enquadrar === 'barras' ? ' com barras' : ', preenchendo a tela'}`);
  } else {
    partes.push(`[base]scale=${w}:${h},setsar=1[geo]`);
  }
  const depois = [];
  if (legenda) {
    // a legenda fica acima da faixa de baixo que o app da rede cobre (nome, descrição, botões)
    const estilo = vertical
      ? 'FontName=DejaVu Sans,FontSize=10,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=50'
      : 'FontName=DejaVu Sans,FontSize=16,Bold=1,PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BorderStyle=1,Outline=2,Shadow=1,Alignment=2,MarginV=20';
    depois.push(`subtitles=filename=${escaparValor(legenda)}${legendaEstilo ? `:force_style=${escaparValor(estilo)}` : ''}`);
    passos.push('legenda');
  }
  const posicoesY = posicionarTextos(x.textos, textosArquivos, w, h, { legenda: Boolean(legenda) });
  x.textos.forEach((t, i) => {
    const { tam } = medidasTexto(w, h, t.tamanho);
    const linhas = [].concat(textosArquivos[i] || []);
    const alturaLinha = Math.round(tam * ALTURA_LINHA);
    const y0 = posicoesY[i];
    const borda = Math.max(2, Math.round(tam * 0.08));
    linhas.forEach((arquivoLinha, j) => {
      const opcoes = [
        ...(fonte ? [`fontfile=${escaparValor(fonte)}`] : []),
        `textfile=${escaparValor(arquivoLinha)}`, 'expansion=none', `fontsize=${tam}`, 'fontcolor=white',
        `borderw=${borda}`, 'bordercolor=black@0.85', 'shadowx=2', 'shadowy=2', 'shadowcolor=black@0.5',
        ...(t.fundo ? ['box=1', 'boxcolor=black@0.5', `boxborderw=${Math.round(tam * 0.25)}`] : []),
        'x=(w-text_w)/2', `y=${Math.max(0, y0 + j * alturaLinha)}`,
      ];
      if (t.inicio !== null || t.fim !== null) opcoes.push(`enable=${escaparValor(`between(t,${fmt(t.inicio ?? 0)},${fmt(t.fim ?? 1e9)})`)}`);
      depois.push(`drawtext=${opcoes.join(':')}`);
    });
  });
  if (x.textos.length) passos.push(x.textos.length === 1 ? 'texto na tela' : `${x.textos.length} textos na tela`);
  if (x.fade && duracao) {
    const f = Math.min(x.fade, duracao / 3);
    depois.push(`fade=t=in:st=0:d=${fmt(f)}`, `fade=t=out:st=${fmt(Math.max(0, duracao - f))}:d=${fmt(f)}`);
    passos.push(`fade de ${String(fmt(f)).replace('.', ',')} s`);
  }
  partes.push(`[geo]${depois.length ? depois.join(',') : 'null'}[vpos]`);
  if (entradaMarca !== null) {
    const [mx, my] = POSICOES_MARCA[x.posicaoMarca].map((e) => e.replace(/M/g, String(Math.round(w * 0.03))));
    partes.push(`[${entradaMarca}:v]scale=${par(w * x.tamanhoMarca)}:-1,format=rgba,colorchannelmixer=aa=${fmt(x.opacidadeMarca)}[marca]`);
    partes.push(`[vpos][marca]overlay=${mx}:${my},format=yuv420p[v]`);
    passos.push("marca d'água");
  } else {
    partes.push('[vpos]format=yuv420p[v]');
  }
  // áudio: a voz (com a velocidade), a música por baixo, o volume das redes e o fade
  const temVoz = inf.temAudio;
  const temMusica = entradaMusica !== null;
  if (temVoz) partes.push(`[0:a]${vel !== 1 ? `${cadeiaAtempo(vel).map((f) => `atempo=${f}`).join(',')},` : ''}aresample=48000[voz]`);
  if (temMusica) partes.push(`[${entradaMusica}:a]volume=${fmt(x.volumeMusica)},aresample=48000[mus]`);
  let ultimo = null;
  if (temVoz && temMusica) {
    if (x.abaixarMusica) {
      partes.push('[voz]asplit=2[voz1][vozsc]', '[mus][vozsc]sidechaincompress=threshold=0.03:ratio=10:attack=15:release=350[musb]');
      partes.push('[voz1][musb]amix=inputs=2:duration=first:dropout_transition=0,volume=2[mix]');
      passos.push('música de fundo (abaixa quando alguém fala)');
    } else {
      partes.push('[voz][mus]amix=inputs=2:duration=first:dropout_transition=0,volume=2[mix]');
      passos.push('música de fundo');
    }
    ultimo = 'mix';
  } else if (temMusica) { ultimo = 'mus'; passos.push('música'); } else if (temVoz) ultimo = 'voz';
  if (ultimo) {
    const fimAudio = [];
    if (x.normalizar) { fimAudio.push('loudnorm=I=-14:TP=-1.5:LRA=11', 'aresample=48000'); passos.push('áudio no volume das redes (-14 LUFS)'); }
    if (x.fade && duracao) {
      const f = Math.min(x.fade, duracao / 3);
      fimAudio.push(`afade=t=in:st=0:d=${fmt(f)}`, `afade=t=out:st=${fmt(Math.max(0, duracao - f))}:d=${fmt(f)}`);
    }
    partes.push(`[${ultimo}]${fimAudio.length ? fimAudio.join(',') : 'anull'}[a]`);
  }
  return { filtro: partes.join(';'), temAudio: Boolean(ultimo), duracao, largura: w, altura: h, passos };
}

/** Desloca os tempos da legenda para o vídeo cortado/acelerado (a legenda segue o vídeo ORIGINAL). Puro. */
function ajustarLegenda(texto, ext, { inicio = 0, velocidade = 1 } = {}) {
  if (!inicio && velocidade === 1) return texto;
  const novo = (s) => Math.max(0, (s - inicio) / velocidade);
  if (ext === '.ass') {
    return texto.replace(/(\d+):(\d{2}):(\d{2})\.(\d{2})/g, (_, hh, mm, ss, cc) => {
      const t = novo(Number(hh) * 3600 + Number(mm) * 60 + Number(ss) + Number(cc) / 100);
      const H = Math.floor(t / 3600); const M = Math.floor((t % 3600) / 60); const S = t % 60;
      return `${H}:${String(M).padStart(2, '0')}:${S.toFixed(2).padStart(5, '0')}`;
    });
  }
  return texto.replace(/(\d{1,2}):(\d{2}):(\d{2})([,.])(\d{3})/g, (_, hh, mm, ss, sep, ms) => {
    const t = novo(Number(hh) * 3600 + Number(mm) * 60 + Number(ss) + Number(ms) / 1000);
    const total = Math.round(t * 1000);
    const H = Math.floor(total / 3600000); const M = Math.floor((total % 3600000) / 60000);
    const S = Math.floor((total % 60000) / 1000); const MS = total % 1000;
    return `${String(H).padStart(2, '0')}:${String(M).padStart(2, '0')}:${String(S).padStart(2, '0')}${sep}${String(MS).padStart(3, '0')}`;
  });
}

// ---------------------------------------------------------------------------
// Com o ffmpeg
// ---------------------------------------------------------------------------
function acharFonte(existe = fs.existsSync) {
  return FONTES.find((f) => { try { return existe(f); } catch { return false; } }) || null;
}

/**
 * Duração, tamanho (já com a rotação do celular), quadros por segundo, áudio e HDR. Lê o cabeçalho que o ffmpeg
 * imprime. hdr: "hlg" (iPhone, a maioria dos celulares) ou "pq" (HDR10), pela curva de transferência do vídeo.
 */
function lerInfo(saida) {
  const s = String(saida || '');
  const dur = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s);
  const v = /Stream #\d+:\d+[^\n]*?: Video: [^\n]*?, (\d{2,5})x(\d{2,5})(?=[,\s[])/.exec(s);
  const fps = /, (\d+(?:\.\d+)?) fps/.exec(s);
  const rot = /rotation of (-?\d+(?:\.\d+)?) degrees/.exec(s) || /rotate\s*:\s*(-?\d+)/.exec(s);
  const curva = /Stream #\d+:\d+[^\n]*?: Video: [^\n]*?(arib-std-b67|smpte2084)/.exec(s);
  const r = {
    duracao: dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : null, largura: null, altura: null,
    fps: fps ? Number(fps[1]) : null, temAudio: /Stream #\d+:\d+[^\n]*?: Audio:/.test(s), rotacao: rot ? Number(rot[1]) : 0,
    hdr: curva ? (curva[1] === 'smpte2084' ? 'pq' : 'hlg') : null,
  };
  if (v) {
    r.largura = Number(v[1]);
    r.altura = Number(v[2]);
    if (Math.abs(Math.round(r.rotacao)) % 180 === 90) [r.largura, r.altura] = [r.altura, r.largura]; // o ffmpeg já gira ao decodificar
  }
  return r;
}

function info(arquivo, { cwd = process.cwd(), ffmpeg = video.acharFfmpeg(), execFileFn = execFile } = {}) {
  if (!ffmpeg) return Promise.reject(new Error(`ver o vídeo ${video.SEM_FFMPEG}`));
  let abs;
  try { abs = video.conferirEntrada(path.resolve(cwd, String(arquivo || '')), video.VIDEOS, 'o vídeo'); } catch (e) { return Promise.reject(e); }
  return new Promise((resolve) => {
    // sem arquivo de saída o ffmpeg só descreve a entrada e sai com código 1: normal
    execFileFn(ffmpeg, ['-hide_banner', '-protocol_whitelist', 'file', '-i', `file:${abs}`], { timeout: 60000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      resolve({ arquivo: abs, ...lerInfo(stderr) });
    });
  });
}

function tmpSeguro() { return fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-code-edicao-')); }

// este ffmpeg tem o zscale e o tonemap (para converter HDR)? Pergunta uma vez por ffmpeg, só quando aparece um HDR.
const filtrosHdr = new Map();
function temConversorHdr(ffmpeg, execFileFn = execFile) {
  if (!filtrosHdr.has(ffmpeg)) {
    filtrosHdr.set(ffmpeg, new Promise((resolve) => {
      execFileFn(ffmpeg, ['-hide_banner', '-filters'], { timeout: 20000, maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
        const s = String(stdout || '');
        resolve(/\szscale\s/.test(s) && /\stonemap\s/.test(s));
      });
    }));
  }
  return filtrosHdr.get(ffmpeg);
}

/** HDR em alguma entrada: converte (se der) e marca a saída como BT.709; senão, nada muda. */
async function planoHdr(infos, ffmpeg, execFileFn) {
  if (!infos.some((i) => i && i.hdr)) return { converter: false, marcas: [] };
  return { converter: await temConversorHdr(ffmpeg, execFileFn), marcas: MARCAS_SDR };
}

const saidaVideo = (q, temAudio) => [
  '-c:v', 'libx264', '-preset', 'medium', '-crf', String(QUALIDADES[q].crf), '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
  ...(temAudio ? ['-c:a', 'aac', '-b:a', QUALIDADES[q].audio, '-ar', '48000'] : ['-an']),
];

/** Edita o vídeo com a receita. @returns {Promise<{arquivo, duracao, largura, altura, passos}>} */
async function editar(arquivo, receita = {}, { saida, cwd = process.cwd(), ffmpeg = video.acharFfmpeg(), execFileFn = execFile } = {}) {
  if (!ffmpeg) throw new Error(`editar vídeo ${video.SEM_FFMPEG}`);
  const abs = video.conferirEntrada(path.resolve(cwd, String(arquivo || '')), video.VIDEOS, 'o vídeo');
  const x = normalizarReceita(receita, { cwd });
  const inf = await info(abs, { ffmpeg, execFileFn });
  if (!inf.largura) throw new Error('não achei imagem nesse arquivo (é só áudio?).');
  if (x.inicio && inf.duracao && x.inicio >= inf.duracao) throw new Error(`o corte começa em ${fmt(x.inicio)} s, mas o vídeo tem ${fmt(inf.duracao)} s.`);
  const destino = video.destinoVideo({ saida, base: abs, sufixo: '-editado', cwd });
  const tmp = tmpSeguro();
  try {
    const { w: largura, h: altura } = tamanhoFinal(inf, x);
    // um arquivo por linha de cada texto (cada linha é centralizada sozinha)
    const textosArquivos = x.textos.map((t, i) => quebrarLinhas(t.texto, medidasTexto(largura, altura, t.tamanho).porLinha)
      .split('\n').map((linha, j) => {
        const f = path.join(tmp, `texto-${i}-${j}.txt`);
        fs.writeFileSync(f, linha);
        return f;
      }));
    let legenda = null;
    if (x.legenda) {
      const ext = path.extname(x.legenda).toLowerCase();
      const bruto = fs.readFileSync(x.legenda);
      let texto = bruto.toString('utf8');
      if (!Buffer.from(texto, 'utf8').equals(bruto)) texto = bruto.toString('latin1'); // .srt antigo em Latin-1
      legenda = path.join(tmp, `legenda${ext}`);
      fs.writeFileSync(legenda, ajustarLegenda(texto.replace(/^\uFEFF/, ''), ext, { inicio: x.inicio || 0, velocidade: x.velocidade }));
    }
    const entradas = [
      ...(x.inicio ? ['-ss', fmt(x.inicio)] : []),
      ...(x.fim !== undefined ? ['-t', fmt(x.fim - (x.inicio || 0))] : []),
      ...video.entrada(abs),
    ];
    let proxima = 1;
    let entradaMusica = null;
    let entradaMarca = null;
    if (x.musica) { entradas.push('-stream_loop', '-1', ...video.entrada(x.musica)); entradaMusica = proxima++; }
    if (x.marca) { entradas.push(...video.entrada(x.marca)); entradaMarca = proxima++; }
    const hdr = await planoHdr([inf], ffmpeg, execFileFn);
    const plano = montarEdicao(inf, x, { textosArquivos, legenda, legendaEstilo: legenda && !legenda.endsWith('.ass'), fonte: acharFonte(), entradaMusica, entradaMarca, converterHdr: hdr.converter });
    const limite = x.musica ? (plano.duracao ? ['-t', fmt(plano.duracao)] : ['-shortest']) : [];
    await video.rodar(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-n', ...entradas,
      '-filter_complex', plano.filtro, '-map', '[v]', ...(plano.temAudio ? ['-map', '[a]'] : []),
      ...saidaVideo(x.qualidade, plano.temAudio), ...hdr.marcas, ...limite, `file:${destino}`], { execFileFn });
    return { arquivo: destino, duracao: plano.duracao, largura: plano.largura, altura: plano.altura, passos: plano.passos };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

/** Junta clipes num vídeo só. transicao: "nenhuma" ou "suave" (fade entre eles). */
async function juntar(arquivos, { transicao = 'nenhuma', formato, enquadrar = 'barras', normalizar = true, qualidade = 'normal', saida, cwd = process.cwd(), ffmpeg = video.acharFfmpeg(), execFileFn = execFile } = {}) {
  if (!ffmpeg) throw new Error(`juntar vídeos ${video.SEM_FFMPEG}`);
  const clipes = (Array.isArray(arquivos) ? arquivos : []).map((a, i) => video.conferirEntrada(path.resolve(cwd, String(a || '')), video.VIDEOS, `o vídeo ${i + 1}`));
  if (clipes.length < 2) throw new Error('informe pelo menos 2 vídeos para juntar.');
  if (clipes.length > MAX_CLIPES) throw new Error(`no máximo ${MAX_CLIPES} vídeos por vez.`);
  if (!['nenhuma', 'suave'].includes(transicao)) throw new Error('transição: use nenhuma ou suave.');
  if (!ENQUADRAMENTOS.includes(enquadrar)) throw new Error(`enquadrar: use ${ENQUADRAMENTOS.join(', ')}.`);
  if (!QUALIDADES[qualidade]) throw new Error(`qualidade: use ${lista(QUALIDADES)}.`);
  const x = normalizarReceita({ formato, qualidade }, { cwd });
  const infos = [];
  for (const c of clipes) {
    const inf = await info(c, { ffmpeg, execFileFn });
    if (!inf.largura) throw new Error(`não achei imagem em ${path.basename(c)}.`);
    if (!inf.duracao) throw new Error(`não consegui ler a duração de ${path.basename(c)}.`);
    infos.push(inf);
  }
  const { w, h } = tamanhoFinal(infos[0], x);
  const minDur = Math.min(...infos.map((i) => i.duracao));
  const d = transicao === 'suave' ? Math.min(0.6, minDur / 3) : 0;
  const hdr = await planoHdr(infos, ffmpeg, execFileFn);
  const partes = [];
  infos.forEach((inf, i) => {
    // um clipe HDR no meio de clipes normais: convertido antes de juntar, senão ele sai desbotado
    if (inf.hdr && hdr.converter) partes.push(`[${i}:v]${cadeiaSdr(inf.hdr)}[s${i}]`);
    partes.push(geometria(inf.hdr && hdr.converter ? `s${i}` : `${i}:v`, `g${i}`, w, h, enquadrar, `j${i}`));
    partes.push(`[g${i}]fps=30,format=yuv420p,settb=AVTB[v${i}]`);
    partes.push(inf.temAudio
      ? `[${i}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`
      : `anullsrc=r=48000:cl=stereo,atrim=duration=${fmt(inf.duracao)},aformat=sample_fmts=fltp:channel_layouts=stereo[a${i}]`);
  });
  let vFinal;
  let aFinal;
  if (d) {
    let offset = 0;
    let vAnt = 'v0';
    let aAnt = 'a0';
    for (let i = 1; i < infos.length; i++) {
      offset += infos[i - 1].duracao - d;
      partes.push(`[${vAnt}][v${i}]xfade=transition=fade:duration=${fmt(d)}:offset=${fmt(offset)}[vx${i}]`);
      partes.push(`[${aAnt}][a${i}]acrossfade=d=${fmt(d)}[ax${i}]`);
      vAnt = `vx${i}`;
      aAnt = `ax${i}`;
    }
    vFinal = vAnt;
    aFinal = aAnt;
  } else {
    partes.push(`${infos.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${infos.length}:v=1:a=1[vc][ac]`);
    vFinal = 'vc';
    aFinal = 'ac';
  }
  partes.push(`[${vFinal}]format=yuv420p[v]`);
  partes.push(`[${aFinal}]${normalizar ? 'loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000' : 'anull'}[a]`);
  const destino = video.destinoVideo({ saida: saida || 'juntado.mp4', cwd });
  await video.rodar(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-n', ...clipes.flatMap((c) => video.entrada(c)),
    '-filter_complex', partes.join(';'), '-map', '[v]', '-map', '[a]', ...saidaVideo(qualidade, true), ...hdr.marcas, `file:${destino}`], { execFileFn });
  const duracao = infos.reduce((s, i) => s + i.duracao, 0) - d * (infos.length - 1);
  const passos = [];
  if (infos.some((i) => i.hdr)) {
    passos.push(hdr.converter ? 'clipes HDR convertidos para cores normais (SDR)'
      : 'ATENÇÃO: há clipe HDR e este ffmpeg não tem o filtro zscale para converter; as cores dele podem ficar desbotadas');
  }
  return { arquivo: destino, clipes: clipes.length, duracao, largura: w, altura: h, transicao, passos };
}

/** A capa: a imagem de um instante (tempo) ou a mais representativa do começo do vídeo, em .jpg. */
async function capa(arquivo, { tempo, saida, cwd = process.cwd(), ffmpeg = video.acharFfmpeg(), execFileFn = execFile } = {}) {
  if (!ffmpeg) throw new Error(`tirar a capa ${video.SEM_FFMPEG}`);
  const abs = video.conferirEntrada(path.resolve(cwd, String(arquivo || '')), video.VIDEOS, 'o vídeo');
  const inf = await info(abs, { ffmpeg, execFileFn });
  const t = tempo !== undefined && tempo !== null && tempo !== '' ? lerTempo(tempo, 'o tempo da capa') : null;
  if (t !== null && inf.duracao && t >= inf.duracao) throw new Error(`o vídeo tem ${fmt(inf.duracao)} s; escolha um tempo antes disso.`);
  const destino = require('./imagem').destinoNovo({ saida, base: abs, sufixo: '-capa', ext: '.jpg', cwd });
  const inicio = t !== null ? t : (inf.duracao ? Math.min(inf.duracao * 0.1, 3) : 0);
  // a capa de um vídeo HDR também sai com as cores normais (um .jpg é sempre SDR)
  const hdr = await planoHdr([inf], ffmpeg, execFileFn);
  const filtros = [...(hdr.converter ? [cadeiaSdr(inf.hdr)] : []), ...(t === null ? ['thumbnail=90'] : [])];
  await video.rodar(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-n', '-ss', fmt(inicio), ...video.entrada(abs),
    ...(filtros.length ? ['-vf', filtros.join(',')] : []), '-frames:v', '1', '-q:v', '2', `file:${destino}`], { execFileFn });
  return { arquivo: destino, tempo: Number(fmt(inicio)), hdrConvertido: Boolean(inf.hdr && hdr.converter) };
}

/** Só o áudio: .mp3 (padrão) ou .m4a. */
async function extrairAudio(arquivo, { saida, cwd = process.cwd(), ffmpeg = video.acharFfmpeg(), execFileFn = execFile } = {}) {
  if (!ffmpeg) throw new Error(`tirar o áudio ${video.SEM_FFMPEG}`);
  const abs = video.conferirEntrada(path.resolve(cwd, String(arquivo || '')), video.VIDEOS, 'o vídeo');
  const inf = await info(abs, { ffmpeg, execFileFn });
  if (!inf.temAudio) throw new Error('esse vídeo não tem áudio.');
  const ext = saida && path.extname(String(saida)).toLowerCase() === '.m4a' ? '.m4a' : '.mp3';
  const destino = video.destinoVideo({ saida, base: abs, sufixo: '-audio', cwd, ext });
  await video.rodar(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-n', ...video.entrada(abs), '-vn',
    ...(ext === '.m4a' ? ['-c:a', 'aac', '-b:a', '192k'] : ['-c:a', 'libmp3lame', '-q:a', '2']), `file:${destino}`], { execFileFn });
  return { arquivo: destino };
}

/** Texto curto do que foi feito, para o terminal e para o modelo. */
function descreverResultado(r) {
  const dur = r.duracao ? ` — ${Math.floor(r.duracao / 60)}:${String(Math.round(r.duracao % 60)).padStart(2, '0')}` : '';
  return `${r.largura}x${r.altura}${dur}${r.passos && r.passos.length ? `; ${r.passos.join(', ')}` : ''}`;
}

module.exports = {
  FORMATOS, APELIDOS_FORMATO, ENQUADRAMENTOS, CORES, QUALIDADES, POSICOES_TEXTO, TAMANHOS_TEXTO, POSICOES_MARCA, FONTES,
  escaparValor, lerTempo, lerCorte, cadeiaAtempo, quebrarLinhas, normalizarReceita, tamanhoFinal, medidasTexto,
  posicionarTextos, montarEdicao,
  ajustarLegenda, lerInfo, acharFonte, info, editar, juntar, capa, extrairAudio, descreverResultado,
};
