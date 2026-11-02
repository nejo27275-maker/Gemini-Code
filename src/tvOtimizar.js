// src/tvOtimizar.js (v0.46.0) — "melhorador de TV": diagnóstico e otimização por adb
// O que dá para fazer de verdade numa Android TV lenta (nada de mágica, nada que mexa no sistema de fábrica):
//   1. animações mais curtas (0,5x) — a navegação parece bem mais rápida;            [settings put global]
//   2. limpar o cache de todos os apps — libera espaço quando o disco está cheio;      [pm trim-caches]
//   3. fechar os apps que ficaram rodando em segundo plano — libera memória;           [am kill-all]
// e mostrar quais apps ocupam mais memória e disco, para a PESSOA decidir o que desinstalar (nunca automático).
// Cada passo pergunta antes. "desfazer" volta as animações para 1x. Os comandos são fixos e vão entre aspas
// simples para o shell do aparelho (noAparelho), como em src/tools/adbTools.js.
'use strict';

const ANIMACOES = Object.freeze(['window_animation_scale', 'transition_animation_scale', 'animator_duration_scale']);

function kb(texto, chave) {
  const m = new RegExp(`^${chave}:\\s+(\\d+)\\s*kB`, 'mi').exec(texto || '');
  return m ? Number(m[1]) : null;
}

const mb = (bytes) => Math.round(bytes / (1024 * 1024));
const gb = (kbs) => (kbs / (1024 * 1024)).toFixed(1).replace('.', ',');

function lerDf(texto) {
  // toybox/coreutils: "Filesystem 1K-blocks Used Available Use% Mounted on" e uma linha por partição
  const linha = String(texto || '').split('\n').map((l) => l.trim().split(/\s+/)).find((p) => p.length >= 5 && /^\d+$/.test(p[1]) && /^\d+$/.test(p[2]));
  if (!linha) return null;
  const total = Number(linha[1]);
  const usado = Number(linha[2]);
  return { totalKb: total, usadoKb: usado, livreKb: Number(linha[3]), pct: total ? Math.round((usado / total) * 100) : null };
}

function lerMemoriaPorApp(texto) {
  const inicio = String(texto || '').indexOf('Total PSS by process');
  if (inicio < 0) return [];
  const out = [];
  for (const l of texto.slice(inicio).split('\n').slice(1)) {
    const m = /^\s*([\d,]+)K:\s+(\S+)/.exec(l);
    if (!m) { if (out.length) break; continue; }
    out.push({ app: m[2], mb: Math.round(Number(m[1].replace(/,/g, '')) / 1024) });
  }
  return out;
}

function lerDiskstats(texto) {
  const lista = (rotulo) => {
    const m = new RegExp(`^${rotulo}: (\\[.*\\])`, 'm').exec(texto || '');
    try { return m ? JSON.parse(m[1]) : null; } catch { return null; }
  };
  const nomes = lista('Package Names');
  if (!Array.isArray(nomes)) return [];
  const [app, dados, cache] = ['App Sizes', 'App Data Sizes', 'Cache Sizes'].map((r) => lista(r) || []);
  return nomes.map((nome, i) => ({ app: String(nome), totalMb: mb((app[i] || 0) + (dados[i] || 0) + (cache[i] || 0)), cacheMb: mb(cache[i] || 0) }))
    .filter((a) => a.totalMb >= 1)
    .sort((a, b) => b.totalMb - a.totalMb);
}

/** Lê o estado da TV. `executar(argvNoAparelho)` -> { stdout } | { erro }. Nunca muda nada. */
async function diagnostico(executar) {
  const rodar = async (...argv) => { const r = await executar(argv); return r && !r.erro ? String(r.stdout || '') : ''; };
  const props = await rodar('getprop');
  const prop = (k) => (props.match(new RegExp(`\\[${k.replace(/\./g, '\\.')}\\]:\\s*\\[(.*?)\\]`)) || [])[1] || '';
  const mem = await rodar('cat', '/proc/meminfo');
  const animacoes = {};
  for (const k of ANIMACOES) {
    const v = (await rodar('settings', 'get', 'global', k)).trim();
    animacoes[k] = v === '' || v === 'null' ? 1 : Number(v);
  }
  const apps3 = (await rodar('pm', 'list', 'packages', '-3')).split('\n').filter((l) => l.startsWith('package:')).length;
  return {
    aparelho: [prop('ro.product.brand'), prop('ro.product.model')].filter(Boolean).join(' ') || '(desconhecido)',
    android: prop('ro.build.version.release') || '?',
    memoria: { totalKb: kb(mem, 'MemTotal'), livreKb: kb(mem, 'MemAvailable') ?? kb(mem, 'MemFree') },
    disco: lerDf(await rodar('df', '/data')),
    animacoes,
    appsInstalados: apps3,
    maisMemoria: lerMemoriaPorApp(await rodar('dumpsys', 'meminfo')).slice(0, 5),
    maisEspaco: lerDiskstats(await rodar('dumpsys', 'diskstats')).slice(0, 5),
  };
}

/** Passos recomendados para este diagnóstico (ids de PASSOS). */
function recomendar(d) {
  const passos = [];
  if (Object.values(d.animacoes).some((v) => !(v <= 0.5))) passos.push('animacoes');
  if (d.disco && d.disco.pct !== null && d.disco.pct >= 80) passos.push('cache');
  const { totalKb, livreKb } = d.memoria;
  if (totalKb && livreKb !== null && livreKb / totalKb < 0.25) passos.push('fechar');
  return passos;
}

function relatorio(d) {
  const { totalKb, livreKb } = d.memoria;
  const linhas = [`${d.aparelho} — Android ${d.android}`];
  if (totalKb) linhas.push(`Memória: ${gb(livreKb || 0)} GB livres de ${gb(totalKb)} GB${livreKb / totalKb < 0.25 ? ' (pouca — apps em segundo plano pesam)' : ''}`);
  if (d.disco) linhas.push(`Armazenamento: ${d.disco.pct}% usado (${gb(d.disco.livreKb)} GB livres)${d.disco.pct >= 80 ? ' (quase cheio — deixa a TV lenta)' : ''}`);
  const anim = Object.values(d.animacoes);
  linhas.push(`Animações: ${anim.every((v) => v === anim[0]) ? `${String(anim[0]).replace('.', ',')}x` : anim.join(' / ')}${anim.some((v) => !(v <= 0.5)) ? ' (dá para deixar em 0,5x: navegação mais rápida)' : ''}`);
  linhas.push(`Apps instalados por você: ${d.appsInstalados}`);
  if (d.maisMemoria.length) linhas.push(`Mais memória agora: ${d.maisMemoria.map((a) => `${a.app} (${a.mb} MB)`).join(', ')}`);
  if (d.maisEspaco.length) linhas.push(`Mais espaço: ${d.maisEspaco.map((a) => `${a.app} (${a.totalMb} MB, cache ${a.cacheMb} MB)`).join(', ')}`);
  const rec = recomendar(d);
  linhas.push(rec.length ? `Sugestões: ${rec.map((p) => PASSOS[p].titulo).join('; ')}. Rode: gemini-code tv otimizar` : 'Nada urgente para otimizar.');
  return linhas.join('\n');
}

const PASSOS = Object.freeze({
  animacoes: {
    titulo: 'animações em 0,5x (navegação mais rápida)',
    comandos: ANIMACOES.map((k) => ['settings', 'put', 'global', k, '0.5']),
  },
  cache: {
    titulo: 'limpar o cache de todos os apps (libera espaço; os apps refazem o cache aos poucos)',
    comandos: [['pm', 'trim-caches', '999G']],
  },
  fechar: {
    titulo: 'fechar os apps em segundo plano (libera memória)',
    comandos: [['am', 'kill-all']],
  },
});

/**
 * Pergunta e aplica cada passo. `perguntar(texto)` -> "s"/"n". Devolve [{ passo, feito, erro? }].
 * `passos` padrão: os recomendados pelo diagnóstico.
 */
async function otimizar(executar, perguntar, { passos } = {}) {
  const d = await diagnostico(executar);
  const lista = passos || recomendar(d);
  const feitos = [];
  for (const id of lista) {
    const p = PASSOS[id];
    if (!p) continue;
    const r = String(await perguntar(`\n[gemini-code/tv] ${p.titulo}. Fazer? (s/n) `)).trim().toLowerCase();
    if (r !== 's' && r !== 'y' && r !== 'sim') { feitos.push({ passo: id, feito: false }); continue; }
    let erro = null;
    for (const argv of p.comandos) {
      const res = await executar(argv);
      if (res && res.erro) { erro = res.erro; break; }
    }
    feitos.push({ passo: id, feito: !erro, ...(erro ? { erro } : {}) });
  }
  return { diagnostico: d, feitos };
}

/** Volta as animações para 1x. */
async function desfazer(executar) {
  for (const k of ANIMACOES) {
    const r = await executar(['settings', 'put', 'global', k, '1']);
    if (r && r.erro) return r.erro;
  }
  return null;
}

/** executar() de verdade, pelo adb do config (alvo opcional), com os argumentos protegidos para o shell da TV. */
function executorAdb({ alvo, adbPath } = {}) {
  const adb = require('./tools/adbTools');
  const cfg = require('./config').loadConfig();
  const caminho = adbPath || cfg.adbPath || 'adb';
  const destino = adb.validarAlvo(alvo || cfg.adbSerial || '');
  return (argv) => adb.rodarAdb(caminho, adb.comAlvo(destino, adb.noAparelho(...argv)));
}

module.exports = { ANIMACOES, PASSOS, diagnostico, recomendar, relatorio, otimizar, desfazer, executorAdb, lerDf, lerMemoriaPorApp, lerDiskstats };
