// src/agenda.js
// Pedido do usuário: um calendário simples — anota o que está marcado pra
// um dia (ex.: "dia 7") e depois consulta ("o que eu tenho marcado no dia
// 7?"). Guardado em ~/.gemini-code/agenda.json, sem depender de nenhuma
// conta externa (Google Calendar etc.) nem de chamada de API — é só
// leitura/escrita de arquivo local, então não gasta cota do Gemini.
'use strict';

const path = require('path');
const { HOME_DIR } = require('./config');
const { lerJson, escreverJson } = require('./jsonStore');

const AGENDA_PATH = path.join(HOME_DIR, 'agenda.json');

function carregar() {
  return lerJson(AGENDA_PATH, (j) => j && Array.isArray(j.eventos), () => ({ eventos: [] }));
}

function salvar(agenda) {
  escreverJson(AGENDA_PATH, agenda);
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function formatarData(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Resolve o que o usuário quis dizer com "dia 7" (ou uma data completa) numa
 * data real (YYYY-MM-DD). Regras:
 *  - `data` explícita (YYYY-MM-DD) sempre vence.
 *  - só `dia` (1-31): assume o mês/ano atual; se esse dia já passou este
 *    mês, assume o próximo mês (é o sentido mais provável de "dia 7" dito
 *    hoje se hoje já é depois do dia 7).
 *  - `mes`/`ano` explícitos sobrescrevem esse cálculo automático.
 */
function resolverData({ data, dia, mes, ano } = {}, agora = new Date()) {
  if (data) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
      throw new Error(`Data inválida: "${data}" (use o formato AAAA-MM-DD)`);
    }
    // v0.3.10: "2026-02-31" passava no formato e virava um evento que nunca aparece.
    const [y, m, d] = data.split('-').map(Number);
    const real = new Date(y, m - 1, d);
    if (real.getFullYear() !== y || real.getMonth() !== m - 1 || real.getDate() !== d) {
      throw new Error(`Data inexistente: "${data}"`);
    }
    return data;
  }
  const diaNum = Number(dia);
  if (!diaNum || diaNum < 1 || diaNum > 31) {
    throw new Error('Informe --data AAAA-MM-DD ou --dia N (1-31)');
  }
  let anoAlvo = ano ? Number(ano) : agora.getFullYear();
  let mesAlvo = mes ? Number(mes) - 1 : agora.getMonth();

  if (!ano && !mes) {
    const candidata = new Date(anoAlvo, mesAlvo, diaNum);
    if (candidata < new Date(agora.getFullYear(), agora.getMonth(), agora.getDate())) {
      mesAlvo += 1;
      if (mesAlvo > 11) { mesAlvo = 0; anoAlvo += 1; }
    }
  }
  const resultado = new Date(anoAlvo, mesAlvo, diaNum);
  if (resultado.getDate() !== diaNum) {
    throw new Error(`Dia ${diaNum} não existe nesse mês`);
  }
  return formatarData(resultado);
}

function adicionarEvento(texto, opts = {}) {
  if (!texto || !texto.trim()) throw new Error('Texto do evento não pode ser vazio');
  const data = resolverData(opts);
  const agenda = carregar();
  const evento = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    data,
    texto: texto.trim(),
    criadoEm: new Date().toISOString(),
  };
  agenda.eventos.push(evento);
  salvar(agenda);
  return evento;
}

function listarEventos() {
  return carregar().eventos.slice().sort((a, b) => a.data.localeCompare(b.data));
}

function eventosDoDia(opts = {}) {
  const data = resolverData(opts);
  return { data, eventos: listarEventos().filter((e) => e.data === data) };
}

function proximosEventos(quantos = 5, agora = new Date()) {
  const hoje = formatarData(agora);
  return listarEventos().filter((e) => e.data >= hoje).slice(0, quantos);
}

function removerEvento(id) {
  const agenda = carregar();
  const antes = agenda.eventos.length;
  agenda.eventos = agenda.eventos.filter((e) => e.id !== id);
  const removeu = agenda.eventos.length !== antes;
  if (removeu) salvar(agenda);
  return removeu;
}

module.exports = {
  AGENDA_PATH,
  resolverData,
  adicionarEvento,
  listarEventos,
  eventosDoDia,
  proximosEventos,
  removerEvento,
  formatarData,
};
