// src/code-ia/model.js
// O "cérebro" do code-ia — escrito do zero, em JavaScript puro:
//   1) Memória de conhecimento: o corpus (seed embutido + seu knowledge/skills + o que você ensinar)
//      é cortado em blocos e indexado com BM25 (busca estatística clássica).
//   2) Gerador de código: modelo n-grama de ordem variável (contexto de até 12 tokens) sobre os
//      blocos de código do corpus; completa trechos e para quando não reconhece o contexto.
// Não há rede, pesos baixados nem outro modelo por trás. É um modelo PEQUENO: ele sabe o que
// está no corpus (e melhora conforme você ensina mais), não é um LLM generalista.
'use strict';

const crypto = require('crypto');
const { palavras, tokensDeCodigo } = require('./tokenizer');

const MODEL_VERSION = 3;
const K1 = 1.4;
const B = 0.75;

/** Quebra um markdown em blocos por título (#, ##, ###). Texto antes do 1º título vira bloco "geral". */
function cortarEmBlocos(texto, fonte) {
  const linhas = String(texto || '').replace(/\r\n/g, '\n').split('\n');
  const blocos = [];
  let atual = { titulo: '', corpo: [] };
  let dentroDeCerca = false;
  const fechar = () => {
    const corpo = atual.corpo.join('\n').trim();
    if (corpo || atual.titulo) blocos.push({ titulo: atual.titulo || 'geral', corpo, fonte });
  };
  for (const l of linhas) {
    if (/^```/.test(l)) dentroDeCerca = !dentroDeCerca;
    const h = !dentroDeCerca && l.match(/^#{1,3}\s+(.*)$/);
    if (h) { fechar(); atual = { titulo: h[1].trim(), corpo: [] }; } else atual.corpo.push(l);
  }
  fechar();
  return blocos.filter((b) => b.corpo.length >= 12);
}

function extrairCodigo(corpo) {
  const out = [];
  const re = /```[^\n]*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(corpo))) out.push(m[1]);
  return out;
}

function hashDoCorpus(arquivos) {
  const h = crypto.createHash('sha256');
  h.update(`v${MODEL_VERSION}`);
  for (const a of [...arquivos].sort((x, y) => x.nome.localeCompare(y.nome))) { h.update(a.nome); h.update('\0'); h.update(a.texto); h.update('\0'); }
  return h.digest('hex').slice(0, 16);
}

/** Treina (constrói) o modelo a partir de [{nome, texto}]. */
function treinar(arquivos) {
  const docs = [];
  for (const a of arquivos) for (const b of cortarEmBlocos(a.texto, a.nome)) docs.push(b);

  const m = {
    version: MODEL_VERSION,
    builtAt: new Date().toISOString(),
    corpusHash: hashDoCorpus(arquivos),
    stats: {},
    docs,
  };
  const codigos = codigosDe(m);
  m.stats = {
    arquivos: arquivos.length, blocos: docs.length, blocosDeCodigo: codigos.length,
    tokensDeCodigo: codigos.reduce((a, c) => a + tokensDeCodigo(c).length, 0),
  };
  return m;
}

/** Trechos de código do corpus. Derivado dos blocos (não é gravado em disco: o modelo fica ~metade do tamanho). */
function codigosDe(modelo) {
  if (modelo._codigos) return modelo._codigos;
  const out = [];
  for (const d of modelo.docs) out.push(...extrairCodigo(d.corpo));
  Object.defineProperty(modelo, '_codigos', { value: out, enumerable: false });
  return out;
}

// ---------- busca (BM25) ----------

function prepararIndice(modelo) {
  if (modelo._indice) return modelo._indice;
  const entradas = modelo.docs.map((d) => {
    const tt = palavras(d.titulo), tc = palavras(d.corpo.replace(/```[^\n]*\n[\s\S]*?```/g, (m) => m));
    // título pesa 3x
    const tf = new Map();
    for (const p of tt) tf.set(p, (tf.get(p) || 0) + 3);
    for (const p of tc) tf.set(p, (tf.get(p) || 0) + 1);
    return { tf, len: tt.length * 3 + tc.length, titulo: new Set(tt), nTitulo: tt.length };
  });
  const df = new Map();
  for (const e of entradas) for (const p of e.tf.keys()) df.set(p, (df.get(p) || 0) + 1);
  const N = entradas.length || 1;
  const avg = entradas.reduce((a, e) => a + e.len, 0) / N || 1;
  Object.defineProperty(modelo, '_indice', { value: { entradas, df, N, avg }, enumerable: false });
  return modelo._indice;
}

/** Distância de edição (com troca de letras vizinhas) limitada: devolve > max se passar de max. */
function distancia(a, b, max) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let ant2 = null;
  let ant = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const atual = [i];
    let minimo = i;
    for (let j = 1; j <= b.length; j++) {
      const custo = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(ant[j] + 1, atual[j - 1] + 1, ant[j - 1] + custo);
      if (ant2 && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, ant2[j - 2] + 1);
      atual.push(v);
      if (v < minimo) minimo = v;
    }
    if (minimo > max) return max + 1;
    ant2 = ant; ant = atual;
  }
  return ant[b.length];
}

/** Palavra que não existe no vocabulário (erro de digitação) -> a mais parecida que existe. */
function corrigir(idx, palavra) {
  if (idx.df.has(palavra) || palavra.length < 5) return palavra;
  const max = palavra.length >= 8 ? 2 : 1;
  let melhor = null, dMelhor = max + 1, dfMelhor = -1;
  for (const [v, n] of idx.df) {
    const d = distancia(palavra, v, max);
    if (d < dMelhor || (d === dMelhor && n > dfMelhor)) { melhor = v; dMelhor = d; dfMelhor = n; }
  }
  return melhor && dMelhor <= max ? melhor : palavra;
}

function buscar(modelo, pergunta, { limite = 3 } = {}) {
  const idx = prepararIndice(modelo);
  const originais = [...new Set(palavras(pergunta))];
  const q = [...new Set(originais.map((p) => corrigir(idx, p)))];
  if (!q.length) return [];
  const qset = new Set(q);
  // Palavra "corrigida" por parecença pode ser chute (receita -> rejeita). Em pergunta com 3+ palavras,
  // um bloco só vale se casar com pelo menos uma palavra EXATA (sem correção); perguntas curtas ainda aceitam digitação errada.
  const exatas = new Set(originais.filter((p) => idx.df.has(p)));
  const exigeExata = q.length >= 3;
  const res = [];
  idx.entradas.forEach((e, i) => {
    let score = 0;
    for (const p of q) {
      const f = e.tf.get(p);
      if (!f) continue;
      const n = idx.df.get(p) || 0;
      const idf = Math.log(1 + (idx.N - n + 0.5) / (n + 0.5));
      score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + B * (e.len / idx.avg))));
    }
    if (score > 0 && exigeExata) {
      let tocaExata = false;
      for (const p of exatas) if (e.tf.has(p)) { tocaExata = true; break; }
      if (!tocaExata) return;
    }
    if (score > 0) {
      // bônus pelo título: o quanto o título é "sobre" a pergunta (precisão) e o quanto da pergunta ele cobre
      let noTitulo = 0;
      for (const p of q) if (e.titulo.has(p)) noTitulo++;
      const cobertura = noTitulo / q.length;
      let titulosCasados = 0;
      for (const p of e.titulo) if (qset.has(p)) titulosCasados++;
      const precisao = e.titulo.size ? titulosCasados / e.titulo.size : 0;
      score *= 1 + 0.6 * precisao + 0.4 * cobertura;
      res.push({ doc: modelo.docs[i], score });
    }
  });
  res.sort((a, b) => b.score - a.score);
  return res.slice(0, limite);
}

// ---------- geração (contexto longo) ----------
// Em vez de uma tabela n-grama gigante, guardamos os trechos de código e, a cada passo, procuramos
// o MAIOR contexto (até 12 tokens) que casa com o fim do que foi escrito; o próximo token é o mais
// frequente depois daquele contexto. É um n-grama de ordem variável: copia o que aprendeu com fidelidade
// e PARA quando não reconhece o contexto, em vez de inventar.

const CONTEXTO_MAX = 12;
const FIM = '\u0000';

function fluxo(modelo) {
  if (modelo._fluxo) return modelo._fluxo;
  const flat = [];
  for (const cod of codigosDe(modelo)) { flat.push(...tokensDeCodigo(cod)); flat.push(FIM); }
  Object.defineProperty(modelo, '_fluxo', { value: flat, enumerable: false });
  return flat;
}

/** Índice token -> posições i (i >= 1) onde flat[i - 1] é esse token. Evita varrer o corpus inteiro a cada token gerado. */
function posicoes(modelo) {
  if (modelo._posicoes) return modelo._posicoes;
  const flat = fluxo(modelo);
  const mapa = new Map();
  for (let i = 1; i < flat.length; i++) {
    const t = flat[i - 1];
    const lista = mapa.get(t);
    if (lista) lista.push(i); else mapa.set(t, [i]);
  }
  Object.defineProperty(modelo, '_posicoes', { value: mapa, enumerable: false });
  return mapa;
}

/** Próximo token mais provável. `pos` (opcional) é o índice de posicoes(); sem ele, varre tudo (mais lento, mesmo resultado). */
function melhorProximo(flat, hist, pos) {
  const ultimo = hist[hist.length - 1];
  let melhor = 0;
  let contagem = new Map();
  const max = Math.min(CONTEXTO_MAX, hist.length);
  const visitar = (i) => {
    let l = 1;
    while (l < max && i - 1 - l >= 0 && flat[i - 1 - l] === hist[hist.length - 1 - l]) l++;
    if (l < melhor) return;
    if (l > melhor) { melhor = l; contagem = new Map(); }
    contagem.set(flat[i], (contagem.get(flat[i]) || 0) + 1);
  };
  if (pos) {
    for (const i of pos.get(ultimo) || []) visitar(i);
  } else {
    for (let i = 1; i < flat.length; i++) if (flat[i - 1] === ultimo) visitar(i);
  }
  if (!melhor) return null;
  let top = null, n = 0;
  for (const [t, c] of contagem) if (c > n) { top = t; n = c; }
  return { token: top, contexto: melhor };
}

function profundidade(toks) {
  let d = 0;
  for (const t of toks) { if ('([{'.includes(t)) d++; else if (')]}'.includes(t)) d--; }
  return d;
}

/** Continua um trecho de código. Para ao fechar a instrução, no fim do bloco aprendido ou em maxTokens. */
function completar(modelo, prefixo, { maxTokens = 160 } = {}) {
  const flat = fluxo(modelo);
  const pos = posicoes(modelo);
  const toks = tokensDeCodigo(prefixo);
  if (!toks.length) return '';
  const hist = toks.slice(-40);
  let depth = profundidade(toks);
  let saida = '';
  for (let i = 0; i < maxTokens; i++) {
    const r = melhorProximo(flat, hist, pos);
    // exige contexto de pelo menos 4 tokens (ou o prefixo inteiro, se for menor): contexto curto
    // costuma ser "emenda" de dois trechos diferentes — melhor parar do que misturar
    if (!r || r.token === FIM || r.contexto < Math.min(4, hist.length)) break;
    saida += r.token;
    hist.push(r.token);
    if (hist.length > 40) hist.shift();
    if ('([{'.includes(r.token)) depth++; else if (')]}'.includes(r.token)) depth--;
    if (depth <= 0 && (r.token === ';' || r.token === '\n' || (r.token.includes('\n') && !r.token.trim()))) break;
  }
  return saida.replace(/\s+$/, '');
}

module.exports = { MODEL_VERSION, treinar, buscar, completar, melhorProximo, fluxoDe: fluxo, posicoesDe: posicoes, codigosDe, distancia, cortarEmBlocos, extrairCodigo, hashDoCorpus };
