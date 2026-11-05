// src/perfilCor.js (v0.51.0) — perfis de cor ICC (v4, matriz + curva) montados aqui mesmo, sem arquivo de fora.
// Para quê: foto de iPhone (e de muito celular novo, e print de Mac) vem em Display P3, com o perfil ICC dentro do
// arquivo. Tirar os metadados (-strip, para tirar a localização) tirava também o perfil, e a foto passava a ser lida
// como sRGB: cores desbotadas — o mesmo problema do vídeo HDR. A edição de fotos (src/imagemEdicao.js) converte para
// sRGB antes, como um editor faz ao exportar para a internet; o ImageMagick precisa de um arquivo .icc para isso, e nem
// todo aparelho tem um (Termux, Windows), então o perfil sRGB sai daqui: ~500 bytes, sempre iguais.
'use strict';

const crypto = require('crypto');

const D50 = [0.9642, 1, 0.8249]; // o branco da conexão entre perfis (PCS) do ICC
const BRADFORD = [[0.8951, 0.2664, -0.1614], [-0.7502, 1.7135, 0.0367], [0.0389, -0.0685, 1.0296]];
const D65 = [0.3127, 0.329];
const SRGB = Object.freeze({ primarias: [[0.64, 0.33], [0.3, 0.6], [0.15, 0.06]], branco: D65, descricao: 'sRGB (gemini-code)' });
const DISPLAY_P3 = Object.freeze({ primarias: [[0.68, 0.32], [0.265, 0.69], [0.15, 0.06]], branco: D65, descricao: 'Display P3 (gemini-code)' });
/** A curva do sRGB (também a do Display P3): Y = (aX + b)^g para X >= d; Y = cX abaixo. */
const CURVA_SRGB = Object.freeze([2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045]);

const mul = (a, b) => a.map((linha) => b[0].map((_, j) => linha.reduce((s, v, k) => s + v * b[k][j], 0)));
const mulVet = (m, v) => m.map((linha) => linha.reduce((s, x, k) => s + x * v[k], 0));
function inversa(m) {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h; const B = -(d * i - f * g); const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
}
const xyz = ([x, y]) => [x / y, 1, (1 - x - y) / y];

/**
 * RGB linear -> XYZ: a matriz do espaço (no branco dele) e a mesma levada ao D50 (Bradford), como o ICC pede.
 * @returns {{ m: number[][], m50: number[][], adaptacao: number[][] }}
 */
function matrizes({ primarias, branco }) {
  const W = xyz(branco);
  const P = [0, 1, 2].map((l) => primarias.map((p) => xyz(p)[l])); // colunas = as três cores primárias
  const S = mulVet(inversa(P), W);
  const m = P.map((linha) => linha.map((v, j) => v * S[j]));
  const origem = mulVet(BRADFORD, W);
  const destino = mulVet(BRADFORD, D50);
  const adaptacao = mul(inversa(BRADFORD), mul([0, 1, 2].map((l) => [0, 1, 2].map((c) => (l === c ? destino[l] / origem[l] : 0))), BRADFORD));
  return { m, m50: mul(adaptacao, m), adaptacao };
}

const s15 = (v) => { const b = Buffer.alloc(4); b.writeInt32BE(Math.round(v * 65536)); return b; };
const assinatura = (s) => Buffer.from(s, 'latin1');
const tagXYZ = (v) => Buffer.concat([assinatura('XYZ '), Buffer.alloc(4), ...v.map(s15)]);
const tagSf32 = (m) => Buffer.concat([assinatura('sf32'), Buffer.alloc(4), ...m.flat().map(s15)]);
function tagPara(curva) {
  const cab = Buffer.alloc(12);
  cab.write('para', 0, 'latin1');
  cab.writeUInt16BE(3, 8); // função tipo 3: a do sRGB
  return Buffer.concat([cab, ...curva.map(s15)]);
}
function tagMluc(texto) {
  const utf16 = Buffer.from(String(texto), 'utf16le').swap16(); // UTF-16BE
  const cab = Buffer.alloc(28);
  cab.write('mluc', 0, 'latin1');
  cab.writeUInt32BE(1, 8); // um registro
  cab.writeUInt32BE(12, 12);
  cab.write('enUS', 16, 'latin1');
  cab.writeUInt32BE(utf16.length, 20);
  cab.writeUInt32BE(28, 24);
  return Buffer.concat([cab, utf16]);
}
const alinhar = (b) => (b.length % 4 ? Buffer.concat([b, Buffer.alloc(4 - (b.length % 4))]) : b);

/**
 * Um perfil ICC v4 de monitor (RGB, matriz + curva paramétrica). Determinístico: o mesmo espaço dá sempre os mesmos bytes.
 * @param {{ primarias: number[][], branco: number[], descricao: string }} espaco
 * @returns {Buffer}
 */
function perfilRgb(espaco, curva = CURVA_SRGB) {
  const { m50, adaptacao } = matrizes(espaco);
  const coluna = (j) => [m50[0][j], m50[1][j], m50[2][j]];
  const trc = tagPara(curva);
  const dados = [
    ['desc', tagMluc(espaco.descricao)], ['cprt', tagMluc('No copyright, use freely')], ['wtpt', tagXYZ(D50)],
    ['chad', tagSf32(adaptacao)], ['rXYZ', tagXYZ(coluna(0))], ['gXYZ', tagXYZ(coluna(1))], ['bXYZ', tagXYZ(coluna(2))],
    ['rTRC', trc], ['gTRC', trc], ['bTRC', trc],
  ];
  const tabela = Buffer.alloc(4 + 12 * dados.length);
  tabela.writeUInt32BE(dados.length, 0);
  const blocos = [];
  const ja = new Map(); // as três curvas apontam para os mesmos bytes (permitido pelo ICC)
  let pos = 128 + tabela.length;
  dados.forEach(([sig, buf], i) => {
    let offset = ja.get(buf);
    if (offset === undefined) {
      offset = pos;
      ja.set(buf, pos);
      const b = alinhar(buf);
      blocos.push(b);
      pos += b.length;
    }
    tabela.write(sig, 4 + 12 * i, 'latin1');
    tabela.writeUInt32BE(offset, 8 + 12 * i);
    tabela.writeUInt32BE(buf.length, 12 + 12 * i);
  });
  const cab = Buffer.alloc(128);
  cab.writeUInt32BE(pos, 0);
  cab.writeUInt32BE(0x04300000, 8); // versão 4.3
  cab.write('mntrRGB XYZ ', 12, 'latin1');
  [2026, 1, 1, 0, 0, 0].forEach((v, i) => cab.writeUInt16BE(v, 24 + 2 * i));
  cab.write('acsp', 36, 'latin1');
  D50.forEach((v, i) => s15(v).copy(cab, 68 + 4 * i));
  const perfil = Buffer.concat([cab, tabela, ...blocos]);
  // identificação do perfil: MD5 do perfil com flags, intenção e a própria identificação zerados (já estão)
  crypto.createHash('md5').update(perfil).digest().copy(perfil, 84);
  return perfil;
}

let srgb = null;
/** O perfil sRGB (calculado uma vez). */
const perfilSrgb = () => (srgb || (srgb = perfilRgb(SRGB)));

/**
 * O nome do perfil de cor que veio na foto, para dizer o que foi convertido: só letras, números e pontuação simples,
 * curto (vem do arquivo, de qualquer um). '' se não houver.
 */
function nomeDoPerfil(descricao) {
  return String(descricao || '').normalize('NFC').replace(/[^\p{L}\p{N} ._()+-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, 40);
}

/** Um perfil que já é sRGB (ou ausente) não precisa de conversão: "sRGB IEC61966-2.1", "sRGB built-in", "c2"... */
const jaEhSrgb = (descricao) => {
  const d = String(descricao || '').trim();
  return !d || /\bs-?rgb\b/i.test(d) || /^(c2|c2ci|urgb)$/i.test(d);
};

module.exports = { SRGB, DISPLAY_P3, CURVA_SRGB, matrizes, perfilRgb, perfilSrgb, nomeDoPerfil, jaEhSrgb };
