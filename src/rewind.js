// src/rewind.js
// Desfazer por turno (/rewind), sem custo de IA e sem depender de git.
//
// Como funciona: durante um turno do chat, antes de write_file/edit_file mexerem num arquivo, o
// conteúdo ANTERIOR dele é guardado (ou o fato de que ele não existia). No fim do turno o diário é
// gravado em ~/.gemini-code/rewind/<turno>/. `/rewind` volta o último turno que mexeu em arquivos;
// `/rewind 3` volta os 3 últimos.
//
// Travas: se o arquivo mudou DEPOIS do que o agente gravou (você editou, ou um comando de shell mexeu),
// ele NÃO é sobrescrito sem `--force`. Só desfaz o que passou por write_file/edit_file — o que um
// run_shell fez (rm, mv, npm install…) não é rastreado, e a resposta avisa isso quando for o caso.
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { HOME_DIR } = require('./config');

const MAX_TURNOS = 20;
const MAX_BYTES_ARQUIVO = 2 * 1024 * 1024;

let baseDir = path.join(HOME_DIR, 'rewind');
let turno = null;

function definirPasta(dir) { baseDir = dir; }
function sha(buf) { return crypto.createHash('sha256').update(buf).digest('hex'); }
function hashDe(p) { try { return fs.statSync(p).isFile() ? sha(fs.readFileSync(p)) : null; } catch { return null; } }

// v0.18.0: o id é ordenado por nome para achar os turnos mais novos. Dois turnos no MESMO milissegundo
// (comum em máquina rápida) eram desempatados por um sufixo aleatório, e o /rewind N voltava na ordem
// errada de vez em quando. Agora o carimbo sempre cresce (+1 ms se preciso) e o sufixo só evita colisão.
let ultimoCarimbo = 0;
function proximoCarimbo() { ultimoCarimbo = Math.max(Date.now(), ultimoCarimbo + 1); return ultimoCarimbo; }

function iniciarTurno(rotulo = '', { cwd = process.cwd() } = {}) {
  turno = { id: `t_${proximoCarimbo()}_${crypto.randomBytes(2).toString('hex')}`, rotulo: String(rotulo).slice(0, 120), cwd: path.resolve(cwd), em: new Date().toISOString(), arquivos: [], _pasta: null };
  return turno.id;
}

// Chamado pelas ferramentas ANTES de gravar. Nunca lança: um diário que falha não pode travar a gravação.
function registrar(arquivo) {
  try {
    if (!turno) return;
    const abs = path.resolve(arquivo);
    if (turno.arquivos.some((a) => a.caminho === abs)) return; // só o estado ANTES do primeiro toque no turno
    let st = null;
    try { st = fs.statSync(abs); } catch { /* não existe */ }
    if (!st) { turno.arquivos.push({ caminho: abs, existia: false }); return; }
    if (!st.isFile()) return;
    if (st.size > MAX_BYTES_ARQUIVO) { turno.arquivos.push({ caminho: abs, existia: true, guardado: null, motivo: 'grande' }); return; }
    if (!turno._pasta) { turno._pasta = path.join(baseDir, turno.id); fs.mkdirSync(turno._pasta, { recursive: true }); }
    const nome = `${turno.arquivos.length}.bin`;
    fs.copyFileSync(abs, path.join(turno._pasta, nome));
    turno.arquivos.push({ caminho: abs, existia: true, guardado: nome });
  } catch { /* best-effort */ }
}

// Fecha o turno. Se nenhum arquivo foi tocado, não grava nada.
function finalizarTurno() {
  const t = turno;
  turno = null;
  if (!t || !t.arquivos.length) return null;
  try {
    for (const a of t.arquivos) a.depois = hashDe(a.caminho); // null = arquivo não existe depois
    const pasta = t._pasta || path.join(baseDir, t.id);
    fs.mkdirSync(pasta, { recursive: true });
    const dados = { ...t };
    delete dados._pasta;
    fs.writeFileSync(path.join(pasta, 'turno.json'), JSON.stringify(dados, null, 2));
    podar();
    return { id: t.id, arquivos: t.arquivos.length };
  } catch { return null; }
}

function lerTurnos() {
  let nomes;
  try { nomes = fs.readdirSync(baseDir).filter((n) => n.startsWith('t_')); } catch { return []; }
  const lista = [];
  for (const n of nomes.sort()) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(baseDir, n, 'turno.json'), 'utf8'));
      if (d && d.id === n && Array.isArray(d.arquivos)) lista.push({ ...d, _pasta: path.join(baseDir, n) });
    } catch { /* pasta incompleta: ignora */ }
  }
  return lista; // do mais antigo ao mais novo
}

function podar() {
  const todos = lerTurnos();
  for (const t of todos.slice(0, Math.max(0, todos.length - MAX_TURNOS))) fs.rmSync(t._pasta, { recursive: true, force: true });
}

function listar({ cwd = process.cwd(), limite = 10 } = {}) {
  const raiz = path.resolve(cwd);
  return lerTurnos().filter((t) => t.cwd === raiz).reverse().slice(0, limite)
    .map((t) => ({ id: t.id, rotulo: t.rotulo, em: t.em, arquivos: t.arquivos.map((a) => a.caminho) }));
}

/**
 * Desfaz os `n` turnos mais recentes (da pasta `cwd`), do mais novo para o mais antigo.
 * @returns {{turnos:number, restaurados:string[], removidos:string[], conflitos:string[], naoRastreados:string[]}}
 */
function desfazer({ n = 1, force = false, cwd = process.cwd() } = {}) {
  const raiz = path.resolve(cwd);
  const alvo = lerTurnos().filter((t) => t.cwd === raiz).reverse().slice(0, Math.max(1, n));
  const r = { turnos: 0, restaurados: [], removidos: [], conflitos: [], naoRastreados: [] };
  for (const t of alvo) {
    let limpo = true;
    for (const a of t.arquivos.slice().reverse()) {
      const atual = hashDe(a.caminho);
      if (!force && atual !== (a.depois ?? null)) { r.conflitos.push(a.caminho); limpo = false; continue; }
      try {
        if (!a.existia) {
          if (atual !== null) { fs.unlinkSync(a.caminho); r.removidos.push(a.caminho); }
        } else if (a.guardado) {
          fs.mkdirSync(path.dirname(a.caminho), { recursive: true });
          fs.copyFileSync(path.join(t._pasta, a.guardado), a.caminho);
          r.restaurados.push(a.caminho);
        } else { r.naoRastreados.push(a.caminho); limpo = false; }
      } catch { r.conflitos.push(a.caminho); limpo = false; }
    }
    r.turnos++;
    if (limpo) fs.rmSync(t._pasta, { recursive: true, force: true });
    else break; // não passa para um turno mais antigo por cima de um conflito
  }
  return r;
}

function formatar(r) {
  if (!r.turnos) return 'Nada para desfazer neste projeto (nenhum turno mexeu em arquivos).';
  const linhas = [`Desfeito: ${r.turnos} turno(s).`];
  if (r.restaurados.length) linhas.push('Restaurados:\n' + r.restaurados.map((p) => `  ${p}`).join('\n'));
  if (r.removidos.length) linhas.push('Removidos (não existiam antes):\n' + r.removidos.map((p) => `  ${p}`).join('\n'));
  if (r.conflitos.length) linhas.push('Pulados (mudaram depois do agente; use /rewind --force para sobrescrever):\n' + r.conflitos.map((p) => `  ${p}`).join('\n'));
  if (r.naoRastreados.length) linhas.push('Sem cópia (arquivo grande demais para guardar):\n' + r.naoRastreados.map((p) => `  ${p}`).join('\n'));
  linhas.push('Obs.: só desfaz o que passou por write_file/edit_file; comandos de shell não são rastreados.');
  return linhas.join('\n');
}

module.exports = { definirPasta, iniciarTurno, registrar, finalizarTurno, listar, desfazer, formatar, MAX_TURNOS, MAX_BYTES_ARQUIVO };
