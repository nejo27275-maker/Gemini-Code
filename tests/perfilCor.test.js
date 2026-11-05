'use strict';
// v0.51.0: perfis de cor ICC montados no código (src/perfilCor.js) — o sRGB que a edição de fotos usa para converter
// foto de iPhone (Display P3) antes de tirar os metadados.
const crypto = require('crypto');
const test = require('node:test');
const assert = require('node:assert/strict');
const pc = require('../src/perfilCor');

const perto = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg}: ${a} (esperado ${b} ± ${tol})`);

test('perfil sRGB: um ICC v4 bem formado (cabeçalho, tabela de tags, alinhamento e a identificação MD5)', () => {
  const p = pc.perfilSrgb();
  assert.equal(p.readUInt32BE(0), p.length, 'o tamanho no cabeçalho');
  assert.equal(p.length % 4, 0);
  assert.equal(p.readUInt32BE(8), 0x04300000, 'versão 4.3');
  assert.equal(p.toString('latin1', 12, 24), 'mntrRGB XYZ ');
  assert.equal(p.toString('latin1', 36, 40), 'acsp');
  assert.deepEqual([68, 72, 76].map((o) => p.readInt32BE(o)), [0xf6d6, 0x10000, 0xd32d], 'iluminante D50');
  const n = p.readUInt32BE(128);
  const tags = Array.from({ length: n }, (_, i) => ({
    sig: p.toString('latin1', 132 + 12 * i, 136 + 12 * i), off: p.readUInt32BE(136 + 12 * i), tam: p.readUInt32BE(140 + 12 * i),
  }));
  assert.deepEqual(tags.map((t) => t.sig), ['desc', 'cprt', 'wtpt', 'chad', 'rXYZ', 'gXYZ', 'bXYZ', 'rTRC', 'gTRC', 'bTRC']);
  for (const t of tags) {
    assert.equal(t.off % 4, 0, `${t.sig} alinhada`);
    assert.ok(t.off >= 128 + 4 + 12 * n && t.off + t.tam <= p.length, `${t.sig} dentro do perfil`);
  }
  const trc = tags.filter((t) => t.sig.endsWith('TRC'));
  assert.equal(new Set(trc.map((t) => t.off)).size, 1, 'as três curvas usam os mesmos bytes');
  assert.equal(p.toString('latin1', trc[0].off, trc[0].off + 4), 'para');
  assert.equal(p.readUInt16BE(trc[0].off + 8), 3, 'curva paramétrica tipo 3 (a do sRGB)');
  const desc = tags[0];
  assert.equal(p.toString('latin1', desc.off, desc.off + 4), 'mluc');
  const texto = Buffer.from(p.subarray(desc.off + 28, desc.off + desc.tam)).swap16().toString('utf16le');
  assert.equal(texto, 'sRGB (gemini-code)');
  // a identificação: MD5 do perfil com flags (44), intenção (64) e a própria identificação (84..99) zerados
  const zerado = Buffer.from(p);
  zerado.fill(0, 44, 48);
  zerado.fill(0, 64, 68);
  zerado.fill(0, 84, 100);
  assert.equal(p.subarray(84, 100).toString('hex'), crypto.createHash('md5').update(zerado).digest('hex'));
  assert.ok(pc.perfilSrgb().equals(p), 'sempre os mesmos bytes');
});

test('as contas de cor: o branco vira o D50 do ICC, e as matrizes batem com as de referência do sRGB e do Display P3', () => {
  for (const espaco of [pc.SRGB, pc.DISPLAY_P3]) {
    const { m50 } = pc.matrizes(espaco);
    const branco = m50.map((linha) => linha.reduce((s, v) => s + v, 0));
    [0.9642, 1, 0.8249].forEach((v, i) => perto(branco[i], v, 1e-9, `${espaco.descricao}: branco ${'XYZ'[i]}`));
  }
  // sRGB (IEC 61966-2-1) no D65: a matriz de referência
  const { m } = pc.matrizes(pc.SRGB);
  const ref = [[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]];
  ref.forEach((linha, i) => linha.forEach((v, j) => perto(m[i][j], v, 6e-4, `sRGB m[${i}][${j}]`)));
  // Display P3: a luminância (linha Y) de referência
  const p3 = pc.matrizes(pc.DISPLAY_P3).m;
  [0.2289746, 0.6917385, 0.0792869].forEach((v, j) => perto(p3[1][j], v, 1e-6, `P3 Y[${j}]`));
});

test('nome do perfil vindo da foto: só texto simples e curto; o que já é sRGB não converte', () => {
  assert.equal(pc.nomeDoPerfil('Display P3'), 'Display P3');
  assert.equal(pc.nomeDoPerfil('Adobe RGB (1998)'), 'Adobe RGB (1998)');
  assert.equal(pc.nomeDoPerfil('evil\u001b[2J‮\nname<script>'), 'evil2Jnamescript', 'sem controles, direção nem HTML');
  assert.equal(pc.nomeDoPerfil('x'.repeat(100)).length, 40);
  assert.equal(pc.nomeDoPerfil(undefined), '');
  for (const d of ['', 'sRGB IEC61966-2.1', 'sRGB built-in', 'sRGB (gemini-code)', 'c2', 'uRGB', 's-rgb']) assert.equal(pc.jaEhSrgb(d), true, d);
  for (const d of ['Display P3', 'Adobe RGB (1998)', 'ProPhoto RGB', 'Color LCD', 'scRGB']) assert.equal(pc.jaEhSrgb(d), false, d);
});
