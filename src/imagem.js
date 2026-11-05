// src/imagem.js (v0.46.0) — criar, editar, melhorar e descrever imagens
//   gerar     texto -> imagem (modelo de imagem do Gemini, usa a cota da chave)
//   editar    foto + instrução -> foto nova ("tire o fundo", "deixe em preto e branco")
//   melhorar  foto -> foto mais nítida/clara: com IA (Gemini) ou sem IA, no aparelho, pelo ImageMagick (de graça,
//             offline; Termux: pkg install imagemagick)
//   descrever foto + pergunta -> texto (o modelo do chat, se ele enxerga imagem)
// O arquivo de entrada passa pelas travas de src/imagens.js (segredos, formato, tamanho). A saída é SEMPRE um
// arquivo novo (nunca sobrescreve: "-2", "-3"...) e nunca dentro das áreas protegidas do gemini-code.
'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const EXT_DE_MIME = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif' };
const CODER = { '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.webp': 'webp', '.gif': 'gif' };
const INSTRUCAO_MELHORAR =
  'Melhore a qualidade desta foto mantendo exatamente o mesmo conteúdo, enquadramento, pessoas e objetos: ' +
  'aumente a nitidez, corrija exposição, contraste e cores, reduza ruído e granulação. Não adicione, remova nem ' +
  'invente nada. Devolva só a foto melhorada.';
const TIMEOUT_MAGICK_MS = 120000;

/** Caminho NOVO para a saída: o pedido, ou "<base><sufixo><ext>" ao lado; se existir, -2, -3... */
function destinoNovo({ saida, base, sufixo, ext, cwd = process.cwd() }) {
  const { isProtected, isSecret } = require('./tools/protectedPaths');
  let alvo;
  if (saida) {
    alvo = path.resolve(cwd, String(saida));
    if (!CODER[path.extname(alvo).toLowerCase()]) alvo += ext;
  } else {
    const b = base ? path.join(path.dirname(path.resolve(cwd, base)), path.basename(base, path.extname(base))) : path.join(cwd, 'imagem');
    alvo = `${b}${sufixo}${ext}`;
  }
  const dir = path.dirname(alvo);
  const extFinal = path.extname(alvo);
  const raiz = alvo.slice(0, -extFinal.length);
  for (let i = 2; fs.existsSync(alvo); i++) alvo = `${raiz}-${i}${extFinal}`;
  if (isProtected(alvo) || isSecret(alvo) || isProtected(dir) || isSecret(dir)) throw new Error('esse caminho é protegido do gemini-code; escolha outro lugar para a imagem.');
  return alvo;
}

function gravarNovo(destino, buffer) {
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, buffer, { flag: 'wx' }); // wx: nunca sobrescreve
  return destino;
}

/** ImageMagick: "magick" (versão 7) ou "convert" (6). null se não houver. */
function acharMagick({ env = process.env } = {}) {
  if (process.platform === 'win32') return null; // lá "convert" é outra coisa (do sistema)
  for (const nome of ['magick', 'convert']) {
    for (const dir of String(env.PATH || '').split(path.delimiter).filter((d) => path.isAbsolute(d))) {
      const p = path.join(dir, nome);
      try { fs.accessSync(p, fs.constants.X_OK); if (fs.statSync(p).isFile()) return p; } catch { /* segue */ }
    }
  }
  return null;
}

function rodar(arquivo, args, { timeoutMs = TIMEOUT_MAGICK_MS } = {}) {
  return new Promise((resolve, reject) => {
    execFile(arquivo, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${path.basename(arquivo)} falhou: ${String(stderr || err.message).trim().slice(0, 300)}`));
      resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

/**
 * Argumentos do ImageMagick para melhorar uma foto: endireita pela orientação da câmera, estica o contraste,
 * um pouco mais de cor, reduz ruído leve e dá nitidez. O formato vai explícito ("jpeg:arquivo") para o
 * ImageMagick não adivinhar o tipo pelo conteúdo (é por aí que entram os formatos perigosos dele).
 */
function argsMelhorar(entrada, saida, { ampliar = 1 } = {}) {
  const coderIn = CODER[path.extname(entrada).toLowerCase()];
  const coderOut = CODER[path.extname(saida).toLowerCase()];
  if (!coderIn || !coderOut) throw new Error('use .png, .jpg, .webp ou .gif');
  const fator = Number(ampliar);
  const resize = fator > 1 ? ['-filter', 'Lanczos', '-resize', `${Math.min(4, fator) * 100}%`] : [];
  return [`${coderIn}:${entrada}`, '-auto-orient', ...resize, '-auto-level', '-modulate', '100,108', '-enhance',
    '-unsharp', '0x0.8+0.8+0.01', '-quality', '92', `${coderOut}:${saida}`];
}

async function melhorarLocal(arquivo, { saida, ampliar, magick = acharMagick(), cwd } = {}) {
  if (!magick) throw new Error('para melhorar sem IA, instale o ImageMagick (Termux: pkg install imagemagick; Debian/Ubuntu: sudo apt install imagemagick) — ou use o modo com IA.');
  const entrada = path.resolve(cwd || process.cwd(), arquivo);
  require('./imagens').lerImagem(entrada); // mesmas travas da entrada (segredo, formato, tamanho)
  const ext = path.extname(entrada).toLowerCase() === '.gif' ? '.png' : path.extname(entrada).toLowerCase();
  const destino = destinoNovo({ saida, base: entrada, sufixo: '-melhorada', ext, cwd });
  await rodar(magick, argsMelhorar(entrada, destino, { ampliar }));
  if (!fs.existsSync(destino)) throw new Error('o ImageMagick terminou sem criar a imagem.');
  return { arquivo: destino, modo: 'local' };
}

async function salvarDaIa(inlineData, opcoes) {
  const ext = EXT_DE_MIME[inlineData.mimeType] || '.png';
  const destino = destinoNovo({ ...opcoes, ext });
  return gravarNovo(destino, Buffer.from(inlineData.data, 'base64'));
}

// v0.52.0: a proporção de cada rede, para criar a imagem já no formato certo (as que o modelo de imagem aceita)
const PROPORCOES = Object.freeze({ feed: '4:5', instagram: '4:5', quadrado: '1:1', stories: '9:16', reels: '9:16', status: '9:16', vertical: '9:16', youtube: '16:9', capa: '16:9', horizontal: '16:9' });
const PROPORCOES_ACEITAS = new Set(['1:1', '2:3', '3:2', '3:4', '4:3', '4:5', '5:4', '9:16', '16:9', '21:9']);
/** "feed", "stories", "16:9"... -> a proporção para a API; undefined sem formato. Erro claro para um desconhecido. */
function proporcao(formato) {
  if (formato === undefined || formato === null || formato === '' || formato === 'original') return undefined;
  const f = String(formato).trim().toLowerCase();
  const r = PROPORCOES[f] || (PROPORCOES_ACEITAS.has(f) ? f : null);
  if (!r) throw new Error(`formato "${formato}" desconhecido para criar imagem: use feed, quadrado, stories, youtube ou uma proporção (${[...PROPORCOES_ACEITAS].join(', ')}).`);
  return r;
}

async function gerar(prompt, { saida, cwd, formato, generateImage = (o) => require('./gemini').generateImage(o) } = {}) {
  const p = String(prompt || '').trim();
  if (!p) throw new Error('descreva a imagem que você quer.');
  const aspecto = proporcao(formato);
  const img = await generateImage({ prompt: p, ...(aspecto ? { aspecto } : {}) });
  return { arquivo: await salvarDaIa(img, { saida, base: null, sufixo: `-${Date.now()}`, cwd }), modo: 'ia' };
}

async function editar(arquivo, instrucao, { saida, cwd, generateImage = (o) => require('./gemini').generateImage(o), sufixo = '-editada' } = {}) {
  const i = String(instrucao || '').trim();
  if (!i) throw new Error('diga o que mudar na imagem.');
  const entrada = path.resolve(cwd || process.cwd(), arquivo);
  const foto = require('./imagens').lerImagem(entrada);
  const img = await generateImage({ prompt: i, imagens: [foto] });
  return { arquivo: await salvarDaIa(img, { saida, base: entrada, sufixo, cwd }), modo: 'ia' };
}

/** modo: "auto" (local se houver ImageMagick, senão IA), "local" ou "ia". */
async function melhorar(arquivo, { modo = 'auto', saida, ampliar, cwd, generateImage, magick = acharMagick() } = {}) {
  const usarLocal = modo === 'local' || (modo === 'auto' && magick);
  if (usarLocal) return melhorarLocal(arquivo, { saida, ampliar, magick, cwd });
  return editar(arquivo, INSTRUCAO_MELHORAR, { saida, cwd, generateImage, sufixo: '-melhorada' });
}

/** Pergunta sobre a imagem ao modelo do chat (Gemini, ou um modelo local/OpenAI-compatível que enxergue imagem). */
async function descrever(arquivo, pergunta, { cwd, chatWithTools = (o) => require('./provider').chatWithTools(o) } = {}) {
  const entrada = path.resolve(cwd || process.cwd(), arquivo);
  const foto = require('./imagens').lerImagem(entrada);
  const r = await chatWithTools({
    systemInstruction: 'Você descreve imagens com precisão, em português do Brasil. Diga só o que dá para ver; se não der para saber, diga.',
    history: [{ role: 'user', parts: [{ inlineData: foto.inlineData }, { text: String(pergunta || 'Descreva esta imagem.').slice(0, 2000) }] }],
    tools: [],
  });
  const texto = typeof r.text === 'function' ? r.text() : String(r.text || '');
  return texto.trim() || '(o modelo não respondeu nada sobre a imagem)';
}

module.exports = {
  INSTRUCAO_MELHORAR, CODER, destinoNovo, acharMagick, argsMelhorar, rodar,
  gerar, editar, melhorar, melhorarLocal, descrever, PROPORCOES, proporcao,
};
