// src/datas.js (v0.47.0) — data e hora digitadas por uma pessoa, sem adivinhar.
// O new Date() aceita quase tudo e erra calado: "02/11/2026" vira 11 de FEVEREIRO (formato americano), "2026-02-31"
// vira 3 de março, "-1" vira 2001. Isto aceita só formatos claros:
//   2026-11-04 · 2026-11-04 09:00[:00] · 2026-11-04T09:00:00Z · 2026-11-04T09:00-03:00
//   04/11 · 04/11/2026 · 04/11/26 · 04/11 9h · 04/11/2026 09:30 · 04/11 às 20h30
//   hoje 9h · amanhã 9h30 · ontem 20h · anteontem · agora
// Sem fuso, é a hora local deste aparelho. Usado pela saúde ("quando" de uma anotação), pelas rotinas (--at) e pelo
// post agendado das redes.
'use strict';

function semAcentos(t) {
  return String(t).normalize('NFD').replace(/[̀-ͯ]/g, '');
}

const FORMATOS = 'use 2026-11-04 09:00, 04/11/2026 09:00, 04/11 9h, "amanhã 9h" ou "ontem 20h30"';

/** Data no relógio local, conferindo que dia/mês/hora existem (o Date "conserta" 31/02 para 03/03 sem avisar). */
function dataLocal(ano, mes, dia, h, min, seg, erro) {
  const d = new Date(ano, mes - 1, dia, h, min, seg);
  if (d.getFullYear() !== ano || d.getMonth() !== mes - 1 || d.getDate() !== dia || d.getHours() !== h || d.getMinutes() !== min) throw erro();
  return d;
}

/**
 * @param {string} valor
 * @param {{ agora?: Date, futuro?: 'qualquer'|'proibido'|'obrigatorio', erroFormato?: string, erroFuturo?: string,
 *           erroPassado?: string }} opcoes
 *   futuro 'proibido': registro do que já aconteceu (tolera 5 min de relógio adiantado);
 *   futuro 'obrigatorio': agendamento. Sem o ano, "05/01" em dezembro é o janeiro que vem (mas "01/11" no dia 2/11
 *   é erro: já passou).
 * @returns {Date}
 */
function lerDataHora(valor, { agora = new Date(), futuro = 'qualquer', erroFormato, erroFuturo, erroPassado } = {}) {
  const erro = () => new Error(erroFormato || `Data inválida: ${FORMATOS}.`);
  if (typeof valor !== 'string' || !valor.trim()) throw erro();
  const s = semAcentos(valor.trim().toLowerCase()).replace(/\s+/g, ' ').replace(/ (as|a) /, ' ');
  const hora = (hh, mm) => [hh === undefined ? 0 : Number(hh), mm === undefined ? 0 : Number(mm)];
  let data;
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[ t](\d{2}):(\d{2})(?::(\d{2})(?:\.\d{1,3})?)?)?(?: ?(z|[+-]\d{2}:?\d{2}))?$/.exec(s);
  if (m) {
    const [ano, mes, dia] = [Number(m[1]), Number(m[2]), Number(m[3])];
    const [h, min] = hora(m[4], m[5]);
    const seg = m[6] === undefined ? 0 : Number(m[6]);
    if (m[7]) {
      // com fuso: confere os números no próprio fuso e converte
      const off = m[7] === 'z' ? 0 : (m[7][0] === '-' ? -1 : 1) * (Number(m[7].slice(1, 3)) * 60 + Number(m[7].slice(-2)));
      const utc = new Date(Date.UTC(ano, mes - 1, dia, h, min, seg));
      if (utc.getUTCFullYear() !== ano || utc.getUTCMonth() !== mes - 1 || utc.getUTCDate() !== dia || utc.getUTCHours() !== h || utc.getUTCMinutes() !== min || Math.abs(off) > 14 * 60) throw erro();
      data = new Date(utc.getTime() - off * 60000);
    } else {
      data = dataLocal(ano, mes, dia, h, min, seg, erro);
    }
  } else if ((m = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2}|\d{4}))?(?:,? (\d{1,2})(?:[:h](\d{2}))?h?)?$/.exec(s))) {
    const semAno = m[3] === undefined;
    const ano = semAno ? agora.getFullYear() : m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    const [h, min] = hora(m[4], m[5]);
    data = dataLocal(ano, Number(m[2]), Number(m[1]), h, min, 0, erro);
    // agendando sem o ano: uma data que já passou há mais de uma semana é a do ano que vem ("05/01" em dezembro)
    if (semAno && futuro === 'obrigatorio' && agora.getTime() - data.getTime() > 7 * 86400000) {
      data = dataLocal(ano + 1, Number(m[2]), Number(m[1]), h, min, 0, erro);
    }
  } else if ((m = /^(hoje|amanha|ontem|anteontem)(?: (\d{1,2})(?:[:h](\d{2}))?h?)?$/.exec(s))) {
    const desvio = { hoje: 0, amanha: 1, ontem: -1, anteontem: -2 }[m[1]];
    const base = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + desvio);
    const [h, min] = m[2] === undefined ? [agora.getHours(), agora.getMinutes()] : hora(m[2], m[3]);
    data = dataLocal(base.getFullYear(), base.getMonth() + 1, base.getDate(), h, min, 0, erro);
  } else if (s === 'agora') {
    data = new Date(agora.getTime());
  } else {
    throw erro();
  }
  if (data.getFullYear() < 1900 || data.getFullYear() > 2200) throw erro();
  if (futuro === 'proibido' && data.getTime() > agora.getTime() + 5 * 60000) throw new Error(erroFuturo || 'A data não pode estar no futuro.');
  if (futuro === 'obrigatorio' && data.getTime() <= agora.getTime()) throw new Error(erroPassado || 'Essa data/hora já passou; escolha uma no futuro.');
  return data;
}

module.exports = { lerDataHora, semAcentos, FORMATOS };
