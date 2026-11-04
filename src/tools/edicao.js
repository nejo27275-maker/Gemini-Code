// src/tools/edicao.js (v0.50.0) — o motor de edição do edit_file/edit_files, do jeito de um editor profissional:
//   - acha o trecho exato. Se o arquivo usa CRLF (Windows) e o trecho veio com \n (ou o contrário), adapta o trecho e
//     o texto novo ao fim de linha do arquivo, em vez de recusar;
//   - se a única diferença são espaços/tabs no FIM das linhas, acha mesmo assim, mas só quando há um lugar assim;
//   - quando não acha, mostra o trecho mais parecido do arquivo, com os números de linha, para copiar certo;
//   - depois de gravar, o diff (com números de linha) mostra o que mudou, sem precisar ler o arquivo de novo.
// Tudo puro (sem I/O).
'use strict';

const MAX_LINHA = 240; // caracteres por linha no diff e na dica (código minificado não enche o contexto)
const MAX_CELULAS_LCS = 1000 * 1000; // diff linha a linha só até 1000 x 1000 linhas diferentes; acima, um bloco só

const contar = (texto, trecho) => texto.split(trecho).length - 1;
const paraCRLF = (s) => s.replace(/\r?\n/g, '\r\n');
const paraLF = (s) => s.replace(/\r\n/g, '\n');
const cortarLinha = (l) => (l.length > MAX_LINHA ? `${l.slice(0, MAX_LINHA)}…` : l);

/** Linhas como um editor conta: o "\n" do fim não abre uma linha a mais. */
function contarLinhas(texto) {
  const t = String(texto || '');
  return t ? t.split('\n').length - (t.endsWith('\n') ? 1 : 0) : 0;
}

/** '\r\n' se todas as quebras do texto são CRLF (e há alguma); senão '\n'. */
function fimDeLinha(texto) {
  const crlf = (String(texto).match(/\r\n/g) || []).length;
  return crlf && crlf === (String(texto).match(/\n/g) || []).length ? '\r\n' : '\n';
}

/** O trecho como veio e, se tiver quebra de linha, com o outro fim de linha (o texto novo vai junto). */
function variantes(antigo, novo) {
  const lista = [{ antigo, novo, ajuste: null }];
  if (/(^|[^\r])\n/.test(antigo)) lista.push({ antigo: paraCRLF(antigo), novo: paraCRLF(novo), ajuste: 'o fim de linha CRLF (Windows) do arquivo foi mantido' });
  if (antigo.includes('\r\n')) lista.push({ antigo: paraLF(antigo), novo: paraLF(novo), ajuste: 'o fim de linha LF do arquivo foi mantido' });
  return lista;
}

/**
 * O texto sem espaços/tabs no fim de cada linha, e onde houve corte: [posição no texto novo, total cortado até ali].
 * Com os cortes, uma posição do texto sem espaços volta para a posição no original (paraOriginal).
 */
function semEspacoNoFim(texto) {
  const partes = [];
  const cortes = [];
  const re = /[ \t]+(?=\r?\n|$)/g;
  let ultimo = 0;
  let cortado = 0;
  let m;
  while ((m = re.exec(texto))) {
    partes.push(texto.slice(ultimo, m.index));
    cortes.push([m.index - cortado, cortado + m[0].length]);
    cortado += m[0].length;
    ultimo = m.index + m[0].length;
  }
  partes.push(texto.slice(ultimo));
  return { texto: partes.join(''), cortes };
}

function paraOriginal(cortes, n) {
  let lo = 0;
  let hi = cortes.length - 1;
  let soma = 0;
  while (lo <= hi) {
    const meio = (lo + hi) >> 1;
    if (cortes[meio][0] <= n) { soma = cortes[meio][1]; lo = meio + 1; } else hi = meio - 1;
  }
  return n + soma;
}

/**
 * Aplica UMA edição sobre `texto`. Pura.
 * @returns {{ok: true, texto: string, ocorrencias: number, ajuste: string|null}
 *   | {ok: false, erro: string, dica: string|null}}
 */
function aplicarUmaEdicao(texto, { old_text: antigo, new_text: novo, replace_all: todas = false }) {
  const vs = variantes(antigo, novo);
  // 1) exato, com o fim de linha que o arquivo usa
  for (const v of vs) {
    const n = contar(texto, v.antigo);
    if (!n) continue;
    if (n > 1 && !todas) {
      return { ok: false, erro: `old_text aparece ${n} vezes — inclua mais contexto ao redor para ficar único, ou use replace_all: true.`, dica: null };
    }
    if (todas) return { ok: true, texto: texto.split(v.antigo).join(v.novo), ocorrencias: n, ajuste: v.ajuste };
    const i = texto.indexOf(v.antigo);
    return { ok: true, texto: texto.slice(0, i) + v.novo + texto.slice(i + v.antigo.length), ocorrencias: 1, ajuste: v.ajuste };
  }
  // 2) a diferença é só espaço/tab no fim das linhas: vale se houver UM lugar assim (nunca com replace_all)
  if (!todas) {
    const base = semEspacoNoFim(texto);
    for (const v of vs) {
      const alvo = semEspacoNoFim(v.antigo).texto;
      if (!alvo.trim()) continue;
      const n = contar(base.texto, alvo);
      if (n > 1) {
        return { ok: false, erro: `old_text aparece ${n} vezes (sem contar os espaços no fim das linhas) — inclua mais contexto ao redor para ficar único.`, dica: null };
      }
      if (n !== 1) continue;
      const ini = base.texto.indexOf(alvo);
      const de = paraOriginal(base.cortes, ini);
      const ate = paraOriginal(base.cortes, ini + alvo.length - 1) + 1;
      const ajuste = ['achado sem contar os espaços no fim das linhas', v.ajuste].filter(Boolean).join('; ');
      return { ok: true, texto: texto.slice(0, de) + v.novo + texto.slice(ate), ocorrencias: 1, ajuste };
    }
  }
  return { ok: false, erro: 'old_text não encontrado (0 ocorrências; confira espaços, indentação e quebras de linha).', dica: trechoMaisParecido(texto, antigo) };
}

// ---------------------------------------------------------------------------
// Dica: o trecho mais parecido do arquivo, com números de linha
// ---------------------------------------------------------------------------
function numerar(linhas, ini, fim) {
  const largura = String(fim).length;
  const saida = [];
  for (let i = ini; i < fim; i++) saida.push(`${String(i + 1).padStart(largura)}\t${cortarLinha(linhas[i])}`);
  return saida.join('\n');
}

function bigramas(s) {
  const t = s.replace(/\s+/g, ' ').trim().toLowerCase();
  const m = new Map();
  for (let i = 0; i < t.length - 1; i++) { const b = t.slice(i, i + 2); m.set(b, (m.get(b) || 0) + 1); }
  return { m, total: Math.max(0, t.length - 1) };
}

function parecenca(a, b) {
  if (!a.total || !b.total) return 0;
  let comum = 0;
  for (const [k, n] of a.m) comum += Math.min(n, b.m.get(k) || 0);
  return (2 * comum) / (a.total + b.total);
}

/** Texto da dica, ou null. Usa a linha mais longa do trecho como âncora (a mais fácil de reconhecer). */
function trechoMaisParecido(texto, antigo) {
  const linhas = paraLF(texto).split('\n');
  const pedido = paraLF(antigo).split('\n');
  if (linhas.length > 200000) return null;
  let ancora = -1;
  pedido.forEach((l, i) => { if (l.trim() && (ancora < 0 || l.trim().length > pedido[ancora].trim().length)) ancora = i; });
  if (ancora < 0) return null;
  const alvo = pedido[ancora].trim();
  let lugares = [];
  linhas.forEach((l, i) => { if (l.trim() === alvo) lugares.push(i); });
  let motivo = 'a mesma linha existe com outra indentação ou outros espaços';
  if (!lugares.length || lugares.length > 5) {
    if (alvo.length < 6 || linhas.length > 50000) return null; // linha curta ("}", "end") não diz onde é; arquivo enorme: sem varredura
    const b = bigramas(alvo);
    let melhor = { nota: 0, i: -1 };
    for (let i = 0; i < linhas.length; i++) {
      if (linhas[i].length > 2000 || !linhas[i].trim()) continue;
      const nota = parecenca(b, bigramas(linhas[i]));
      if (nota > melhor.nota) melhor = { nota, i };
    }
    if (melhor.nota < 0.6) return null;
    lugares = [melhor.i];
    motivo = `linha parecida (${Math.round(melhor.nota * 100)}% igual)`;
  }
  const tamanho = Math.min(Math.max(pedido.length, 1), 12);
  const blocos = lugares.slice(0, 3).map((i) => {
    const ini = Math.max(0, i - ancora);
    return numerar(linhas, ini, Math.min(linhas.length, ini + tamanho));
  });
  return `O mais parecido no arquivo (${motivo}); copie exatamente, com a indentação:\n${blocos.join('\n…\n')}`;
}

// ---------------------------------------------------------------------------
// Diff com números de linha
// ---------------------------------------------------------------------------
/** Operações linha a linha entre a e b (LCS): [{t:' '|'-'|'+', a?:índice, b?:índice}]. */
function operacoes(a, b, baseA, baseB) {
  const n = a.length;
  const m = b.length;
  if (!n || !m || n * m > MAX_CELULAS_LCS) {
    return [...a.map((_, k) => ({ t: '-', a: baseA + k })), ...b.map((_, k) => ({ t: '+', b: baseB + k }))];
  }
  const L = new Uint32Array((n + 1) * (m + 1));
  const at = (i, j) => i * (m + 1) + j;
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      L[at(i, j)] = a[i] === b[j] ? L[at(i + 1, j + 1)] + 1 : Math.max(L[at(i + 1, j)], L[at(i, j + 1)]);
    }
  }
  const ops = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { ops.push({ t: ' ', a: baseA + i, b: baseB + j }); i++; j++; } else if (L[at(i + 1, j)] >= L[at(i, j + 1)]) { ops.push({ t: '-', a: baseA + i }); i++; } else { ops.push({ t: '+', b: baseB + j }); j++; }
  }
  while (i < n) { ops.push({ t: '-', a: baseA + i }); i++; }
  while (j < m) { ops.push({ t: '+', b: baseB + j }); j++; }
  return ops;
}

/**
 * Resumo do que mudou entre `antes` e `depois`: contagem e trechos com números de linha (os do arquivo novo; nas
 * linhas que saíram, os do arquivo antigo). '' se nada mudou.
 * @returns {{texto: string, mais: number, menos: number}}
 */
function resumoDiff(antes, depois, { contexto = 3, maxLinhas = 50 } = {}) {
  if (antes === depois) return { texto: '', mais: 0, menos: 0 };
  const a = paraLF(antes).split('\n');
  const b = paraLF(depois).split('\n');
  let ini = 0;
  while (ini < a.length && ini < b.length && a[ini] === b[ini]) ini++;
  let fa = a.length - 1;
  let fb = b.length - 1;
  while (fa >= ini && fb >= ini && a[fa] === b[fb]) { fa--; fb--; }
  if (ini > fa && ini > fb) return { texto: '(mudou só o fim de linha: CRLF/LF)', mais: 0, menos: 0 };
  const meio = operacoes(a.slice(ini, fa + 1), b.slice(ini, fb + 1), ini, ini);
  const ops = [];
  for (let k = 0; k < ini; k++) ops.push({ t: ' ', a: k, b: k });
  ops.push(...meio);
  for (let k = 1; fa + k < a.length; k++) ops.push({ t: ' ', a: fa + k, b: fb + k });
  const mais = ops.filter((o) => o.t === '+').length;
  const menos = ops.filter((o) => o.t === '-').length;
  // trechos: as mudanças com `contexto` linhas em volta; mudanças próximas viram um trecho só
  const marcados = new Uint8Array(ops.length);
  ops.forEach((o, k) => {
    if (o.t === ' ') return;
    for (let x = Math.max(0, k - contexto); x <= Math.min(ops.length - 1, k + contexto); x++) marcados[x] = 1;
  });
  const largura = String(Math.max(a.length, b.length)).length;
  const saida = [];
  let k = 0;
  while (k < ops.length) {
    if (!marcados[k]) { k++; continue; }
    let fim = k;
    while (fim < ops.length && marcados[fim]) fim++;
    const trecho = ops.slice(k, fim);
    const daA = trecho.filter((o) => o.a !== undefined);
    const daB = trecho.filter((o) => o.b !== undefined);
    const iniA = daA.length ? daA[0].a + 1 : (trecho[0].a ?? 0);
    const iniB = daB.length ? daB[0].b + 1 : (trecho[0].b ?? 0);
    saida.push(`@@ -${iniA},${daA.length} +${iniB},${daB.length} @@`);
    for (const o of trecho) {
      const num = o.t === '-' ? o.a + 1 : o.b + 1;
      const linha = o.t === '-' ? a[o.a] : b[o.b];
      saida.push(`${o.t}${String(num).padStart(largura)}\t${cortarLinha(linha)}`);
    }
    k = fim;
  }
  let texto = saida.join('\n');
  if (saida.length > maxLinhas) {
    texto = `${saida.slice(0, maxLinhas).join('\n')}\n… (+${saida.length - maxLinhas} linhas de diff; leia o arquivo para ver o resto)`;
  }
  return { texto, mais, menos };
}

module.exports = {
  aplicarUmaEdicao, trechoMaisParecido, resumoDiff, fimDeLinha, paraCRLF, paraLF, semEspacoNoFim, paraOriginal,
  contarLinhas, MAX_LINHA,
};
