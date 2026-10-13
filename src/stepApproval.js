// src/stepApproval.js
// Aprovação passo a passo (v0.16.0): com `/passo` ligado no chat, antes de CADA write_file/edit_file o agente mostra
// uma prévia da mudança e pergunta s/n/t. Complementa o /plano (que aprova o plano inteiro) e a confirmação do run_shell.
//   s = grava este   n = recusa (o modelo recebe a recusa e pergunta o que você prefere)   t = grava este e desliga o modo
// Só existe no chat interativo (run/rotinas não perguntam nada). Sem terminal para responder (stdin fechado), RECUSA.
'use strict';

const fs = require('fs');
const path = require('path');

// v0.41.0: edit_files (várias edições atômicas) também grava — sem estar aqui, furava o /passo.
const FERRAMENTAS = new Set(['write_file', 'edit_file', 'edit_files']);
const MAX_LINHAS = 12;
let estado = { ativo: false, perguntar: null };

function configurar({ ativo, perguntar } = {}) {
  if (typeof ativo === 'boolean') estado.ativo = ativo;
  if (typeof perguntar === 'function') estado.perguntar = perguntar;
}
function ativo() { return estado.ativo; }

function cortar(texto, rotulo) {
  const linhas = String(texto).split('\n');
  const mostra = linhas.slice(0, MAX_LINHAS).map((l) => `${rotulo} ${l.length > 160 ? l.slice(0, 160) + '…' : l}`);
  if (linhas.length > MAX_LINHAS) mostra.push(`${rotulo} … (+${linhas.length - MAX_LINHAS} linhas)`);
  return mostra.join('\n');
}

/** Texto da prévia mostrada ao usuário. Nunca lança. */
function previa(nome, args = {}) {
  try {
    if (nome === 'edit_files') {
      const edits = Array.isArray(args.edits) ? args.edits : [];
      const blocos = edits.slice(0, 8).map((e, i) => `[${i + 1}/${edits.length}] ${String((e && e.path) || '(sem caminho)')}${e && e.replace_all ? ' (todas as ocorrências)' : ''}\n${cortar((e && e.old_text) ?? '', '-')}\n${cortar((e && e.new_text) ?? '', '+')}`);
      if (edits.length > 8) blocos.push(`… (+${edits.length - 8} edições)`);
      return `edit_files — ${edits.length} edição(ões) aplicadas juntas\n${blocos.join('\n')}`;
    }
    const alvo = String(args.path || '(sem caminho)');
    if (nome === 'edit_file') {
      return `edit_file ${alvo}\n${cortar(args.old_text ?? '', '-')}\n${cortar(args.new_text ?? '', '+')}`;
    }
    const conteudo = typeof args.content === 'string' ? args.content : '';
    const linhasNovas = conteudo ? conteudo.split('\n').length : 0;
    let existe = false; let linhasAntes = 0;
    try { const st = fs.statSync(path.resolve(alvo)); if (st.isFile()) { existe = true; linhasAntes = fs.readFileSync(path.resolve(alvo), 'utf8').split('\n').length; } } catch { /* novo */ }
    const cab = existe ? `write_file ${alvo} — SOBRESCREVE (${linhasAntes} → ${linhasNovas} linhas)` : `write_file ${alvo} — arquivo NOVO (${linhasNovas} linhas)`;
    return `${cab}\n${cortar(conteudo, '+')}`;
  } catch { return `${nome} (prévia indisponível)`; }
}

/** @returns {Promise<{permitido:boolean, motivo?:string}>} */
async function checar(nome, args) {
  if (!estado.ativo || !FERRAMENTAS.has(nome)) return { permitido: true };
  if (!estado.perguntar) return { permitido: false, motivo: 'Recusado: aprovação passo a passo ligada, mas não há terminal para perguntar.' };
  let r;
  try { r = String(await estado.perguntar(`${previa(nome, args)}\nGravar? (s/n/t = sim e desligar o /passo) `)).trim().toLowerCase(); }
  catch { return { permitido: false, motivo: 'Recusado: não foi possível perguntar ao usuário.' }; }
  if (r === 's' || r === 'sim' || r === 'y') return { permitido: true };
  if (r === 't' || r === 'todos') { estado.ativo = false; return { permitido: true }; }
  const onde = nome === 'edit_files' && args && Array.isArray(args.edits) ? [...new Set(args.edits.map((e) => e && e.path))].join(', ') : args && args.path;
  return { permitido: false, motivo: `Recusado pelo usuário: ${nome} em ${onde}. Nada foi gravado. Pergunte o que ele prefere antes de tentar de novo.` };
}

module.exports = { configurar, ativo, checar, previa, FERRAMENTAS };
