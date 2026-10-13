// src/projetos.js
// Pedido do usuário: uma área separada (fora do chat corrido) só pra listar
// os projetos que ele tem em andamento — nome, pasta e uma nota curta —
// pra não depender de lembrar de cabeça ou rolar o histórico do chat.
// Puramente local (sem chamada de API), igual a agenda.js.
'use strict';

const path = require('path');
const { HOME_DIR } = require('./config');
const { lerJson, escreverJson } = require('./jsonStore');

const PROJETOS_PATH = path.join(HOME_DIR, 'projetos.json');

function carregar() {
  return lerJson(PROJETOS_PATH, (j) => j && Array.isArray(j.projetos), () => ({ projetos: [] }));
}

function salvar(dados) {
  escreverJson(PROJETOS_PATH, dados);
}

function adicionarProjeto(nome, { pasta = '', nota = '' } = {}) {
  if (!nome || !nome.trim()) throw new Error('Nome do projeto não pode ser vazio');
  const dados = carregar();
  if (dados.projetos.some((p) => p.nome.toLowerCase() === nome.trim().toLowerCase())) {
    throw new Error(`Já existe um projeto chamado "${nome.trim()}" (use "projetos remover" antes, se quiser recriar)`);
  }
  const projeto = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    nome: nome.trim(),
    pasta: pasta ? path.resolve(pasta) : '',
    nota: nota.trim(),
    criadoEm: new Date().toISOString(),
    atualizadoEm: new Date().toISOString(),
  };
  dados.projetos.push(projeto);
  salvar(dados);
  return projeto;
}

function listarProjetos() {
  return carregar().projetos.slice().sort((a, b) => a.nome.localeCompare(b.nome));
}

function atualizarNota(nomeOuId, nota) {
  const dados = carregar();
  const projeto = dados.projetos.find((p) => p.id === nomeOuId || p.nome.toLowerCase() === String(nomeOuId).toLowerCase());
  if (!projeto) return null;
  projeto.nota = String(nota || '').trim();
  projeto.atualizadoEm = new Date().toISOString();
  salvar(dados);
  return projeto;
}

function removerProjeto(nomeOuId) {
  const dados = carregar();
  const antes = dados.projetos.length;
  dados.projetos = dados.projetos.filter(
    (p) => p.id !== nomeOuId && p.nome.toLowerCase() !== String(nomeOuId).toLowerCase()
  );
  const removeu = dados.projetos.length !== antes;
  if (removeu) salvar(dados);
  return removeu;
}

module.exports = { PROJETOS_PATH, adicionarProjeto, listarProjetos, atualizarNota, removerProjeto };
