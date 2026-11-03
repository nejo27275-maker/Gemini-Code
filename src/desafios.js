// src/desafios.js (v0.47.0) — desafios pessoais ("30 dias de caminhada", "21 dias sem açúcar", "1 post por dia"):
// marcar o dia, sequência de dias seguidos, progresso, lembrete diário (rotina "lembrete" que se encerra sozinha no
// último dia) e o texto do dia para postar nas redes (quem posta é src/redes.js, perguntando antes).
'use strict';

const crypto = require('crypto');
const path = require('path');
const { lerJson, escreverJson } = require('./jsonStore');

const VERSAO = 1;
const MAX_DESAFIOS = 50;
const MAX_DIAS = 366;

/** Data local AAAA-MM-DD (o dia da pessoa, não o de Greenwich). */
function diaLocal(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
/** AAAA-MM-DD + n dias (pelo calendário local; não quebra no horário de verão). */
function somarDias(dia, n) {
  const [a, m, d] = dia.split('-').map(Number);
  return diaLocal(new Date(a, m - 1, d + n));
}
function diasEntre(de, ate) {
  const [a1, m1, d1] = de.split('-').map(Number);
  const [a2, m2, d2] = ate.split('-').map(Number);
  return Math.round((Date.UTC(a2, m2 - 1, d2) - Date.UTC(a1, m1 - 1, d1)) / 86400000);
}

const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();

function limpar(t, max) {
  if (typeof t !== 'string') return '';
  const { semControlesInvisiveis } = require('./ui/textoSeguro');
  // eslint-disable-next-line no-control-regex
  return semControlesInvisiveis(t).replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** Progresso de um desafio num dia: dia atual, feitos, sequência atual e a melhor, porcentagem, se acabou. */
function progresso(d, hoje = diaLocal()) {
  const fim = somarDias(d.inicio, d.dias - 1);
  const passados = Math.max(0, Math.min(d.dias, diasEntre(d.inicio, hoje) + 1));
  const feitos = Object.keys(d.feitos).filter((k) => k >= d.inicio && k <= fim).sort();
  // sequência atual: termina hoje (se feito) ou ontem (hoje ainda dá tempo)
  let seq = 0;
  let dia = d.feitos[hoje] ? hoje : somarDias(hoje, -1);
  while (dia >= d.inicio && d.feitos[dia]) { seq++; dia = somarDias(dia, -1); }
  let melhor = 0;
  let atual = 0;
  let anterior = null;
  for (const k of feitos) { atual = anterior && somarDias(anterior, 1) === k ? atual + 1 : 1; melhor = Math.max(melhor, atual); anterior = k; }
  return {
    diaAtual: Math.min(d.dias, Math.max(0, diasEntre(d.inicio, hoje) + 1)), passados, feitos: feitos.length, sequencia: seq, melhorSequencia: melhor,
    porcentagem: Math.round((feitos.length / d.dias) * 100), fim, terminou: hoje > fim, hojeFeito: Boolean(d.feitos[hoje]),
    comecou: hoje >= d.inicio,
  };
}

function barra(pct, largura = 20) {
  const cheio = Math.round((Math.max(0, Math.min(100, pct)) / 100) * largura);
  return `[${'█'.repeat(cheio)}${'░'.repeat(largura - cheio)}] ${pct}%`;
}

/** Os dias do desafio: ✓ feito, · perdido, ○ ainda vai (ou hoje, sem marcar). 10 por linha. */
function calendario(d, hoje = diaLocal()) {
  const marcas = [];
  for (let i = 0; i < d.dias; i++) {
    const k = somarDias(d.inicio, i);
    marcas.push(d.feitos[k] ? '✓' : k < hoje ? '·' : '○');
  }
  const linhas = [];
  for (let i = 0; i < marcas.length; i += 10) linhas.push(`${String(i + 1).padStart(3)}  ${marcas.slice(i, i + 10).join(' ')}`);
  return linhas.join('\n');
}

/** Texto do dia para as redes: "Dia 5/30 do #desafio30dias de caminhada ✅ (5 dias seguidos) — nota". */
function textoDoDia(d, p, nota = '') {
  const tag = d.hashtag ? ` #${d.hashtag}` : '';
  const seq = p.sequencia > 1 ? ` (${p.sequencia} dias seguidos)` : '';
  return `Dia ${Math.max(1, p.diaAtual)}/${d.dias} do desafio "${d.nome}" ✅${seq}${nota ? ` — ${nota}` : ''}${tag}`.trim();
}

function createDesafiosStore({ arquivo, clock = () => new Date() } = {}) {
  const caminho = arquivo || path.join(require('./config').HOME_DIR, 'desafios.json');
  const vazio = () => ({ version: VERSAO, desafios: [] });
  const ler = () => lerJson(caminho, (x) => x && x.version === VERSAO && Array.isArray(x.desafios), vazio);
  const gravar = (x) => escreverJson(caminho, x, { mode: 0o600 });

  function achar(x, ref) {
    const r = semAcento(typeof ref === 'string' || typeof ref === 'number' ? String(ref) : '');
    const ativos = x.desafios.filter((d) => d.ativo);
    if (!r) {
      if (ativos.length === 1) return ativos[0];
      throw new Error(ativos.length ? `Qual desafio? Ativos: ${ativos.map((d) => `${d.id} (${d.nome})`).join(', ')}.` : 'Nenhum desafio ativo. Crie um com: gemini-code desafio criar "30 dias de caminhada"');
    }
    return x.desafios.find((d) => d.id === r) || x.desafios.find((d) => semAcento(d.nome) === r)
      || ativos.find((d) => semAcento(d.nome).includes(r)) || null;
  }

  function criar({ nome, dias = 30, hora, redes, hashtag, inicio } = {}) {
    const n = limpar(nome, 80);
    if (!n) throw new Error('Dê um nome ao desafio (ex.: "30 dias de caminhada").');
    const total = Number(dias);
    if (!Number.isInteger(total) || total < 1 || total > MAX_DIAS) throw new Error(`"dias" vai de 1 a ${MAX_DIAS}.`);
    let h = '';
    if (hora !== undefined && hora !== null && hora !== '') h = require('./saude').lerHorario(String(hora));
    const lista = Array.isArray(redes) ? redes : typeof redes === 'string' ? redes.split(/[\s,]+/) : [];
    const { REDES } = require('./redes');
    const rs = [...new Set(lista.map((r) => String(r).trim().toLowerCase()).filter(Boolean))];
    const ruim = rs.find((r) => !Object.prototype.hasOwnProperty.call(REDES, r));
    if (ruim) throw new Error(`Rede "${ruim}" não publica por API aqui. Use: ${Object.keys(REDES).join(', ')}.`);
    const tag = typeof hashtag === 'string' ? hashtag.replace(/^#/, '').trim() : '';
    if (tag && !/^[\p{L}\p{N}_]{1,50}$/u.test(tag)) throw new Error('"hashtag": só letras, números e _ (sem espaço).');
    const comeco = inicio || diaLocal(clock());
    if (!/^\d{4}-\d{2}-\d{2}$/.test(comeco)) throw new Error('"inicio" é uma data AAAA-MM-DD.');
    const x = ler();
    if (x.desafios.filter((d) => d.ativo).length >= MAX_DESAFIOS) throw new Error(`No máximo ${MAX_DESAFIOS} desafios ativos.`);
    if (x.desafios.some((d) => d.ativo && semAcento(d.nome) === semAcento(n))) throw new Error(`Já existe um desafio ativo "${n}".`);
    const d = { id: crypto.randomBytes(3).toString('hex'), nome: n, dias: total, inicio: comeco, hora: h, redes: rs, hashtag: tag, feitos: {}, ativo: true, criadoEm: clock().toISOString() };
    x.desafios.push(d);
    gravar(x);
    return d;
  }

  function atualizar(id, mudar) {
    const x = ler();
    const d = x.desafios.find((y) => y.id === id);
    if (!d) throw new Error('Desafio não encontrado.');
    mudar(d);
    gravar(x);
    return d;
  }

  /** Marca um dia (padrão: hoje). Não marca o futuro nem fora do período. */
  function feito(ref, { dia, nota } = {}) {
    const x = ler();
    const d = achar(x, ref);
    if (!d) throw new Error(`Não achei o desafio "${limpar(String(ref), 60)}". Veja os seus com: gemini-code desafio lista`);
    const hoje = diaLocal(clock());
    const k = dia || hoje;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k)) throw new Error('"dia" é uma data AAAA-MM-DD.');
    if (k > hoje) throw new Error('Não dá para marcar um dia que ainda não chegou.');
    if (k < d.inicio) throw new Error(`O desafio começou em ${d.inicio}.`);
    if (k > somarDias(d.inicio, d.dias - 1)) throw new Error(`O desafio terminou em ${somarDias(d.inicio, d.dias - 1)}.`);
    const n = limpar(nota, 200);
    const atualizado = atualizar(d.id, (y) => { y.feitos[k] = n ? { nota: n } : {}; });
    return { desafio: atualizado, progresso: progresso(atualizado, hoje), dia: k, nota: n };
  }

  function desmarcar(ref, dia) {
    const x = ler();
    const d = achar(x, ref);
    if (!d) throw new Error('Desafio não encontrado.');
    const k = dia || diaLocal(clock());
    if (!d.feitos[k]) return false;
    atualizar(d.id, (y) => { delete y.feitos[k]; });
    return true;
  }

  function parar(ref) {
    const x = ler();
    const d = achar(x, ref);
    if (!d) throw new Error('Desafio não encontrado.');
    return atualizar(d.id, (y) => { y.ativo = false; y.paradoEm = clock().toISOString(); });
  }

  function ligarRotina(id, rotinaId) { return atualizar(id, (y) => { y.rotinaId = rotinaId; }); }

  return { caminho, criar, feito, desmarcar, parar, ligarRotina, lista: () => ler().desafios, achar: (ref) => achar(ler(), ref), hoje: () => diaLocal(clock()) };
}

/** Cria o lembrete diário do desafio (rotina "lembrete" com data final = o último dia). */
function criarLembrete(d, { rotinas, timezone }) {
  if (!d.hora) return null;
  const [hh, mm] = d.hora.split(':').map(Number);
  const r = rotinas.create({
    name: `Desafio: ${d.nome}`.slice(0, 80),
    trigger: { type: 'cron', expression: `${mm} ${hh} * * *`, timezone },
    action: { type: 'lembrete', titulo: 'Desafio', texto: `${d.nome} — já fez hoje? Marque com: gemini-code desafio feito`, ate: somarDias(d.inicio, d.dias - 1) },
    category: 'desafios',
  });
  rotinas.activate(r.id);
  return r.id;
}

const INSTRUCOES_ALIADO = [
  'Você é um parceiro de desafios pessoais: ajuda a escolher um desafio realista, quebrar em metas do dia, lembrar,',
  'marcar o progresso (ferramenta "desafio") e comemorar a sequência. Se a pessoa quiser, monte o post do dia e publique',
  'com a ferramenta "redes" (ela mostra e pergunta antes). Seja encorajador sem pressionar; para desafios de saúde',
  '(jejum, exercício forte, dieta), lembre de respeitar os limites do corpo e de falar com um profissional quando fizer sentido.',
].join(' ');

module.exports = {
  diaLocal, somarDias, diasEntre, progresso, barra, calendario, textoDoDia, createDesafiosStore, criarLembrete, INSTRUCOES_ALIADO, MAX_DIAS,
};
