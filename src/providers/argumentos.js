// src/providers/argumentos.js (v0.45.1)
// Os provedores compatíveis com OpenAI (llama.cpp, Ollama, OpenRouter...) entregam os argumentos de uma chamada
// de ferramenta como TEXTO JSON. Modelo pequeno erra: vírgula sobrando no fim, cerca ```json em volta. Antes
// qualquer erro virava {} em silêncio — a ferramenta respondia "precisa de path" e o modelo não entendia o que
// tinha feito de errado. Agora os erros comuns são consertados e, se não der, a chamada leva um marcador que
// src/tools/index.js transforma num erro claro ("argumentos em JSON inválido").
'use strict';

const MARCA = '__argsInvalidos';
const MAX_TRECHO = 300;

function ehObjeto(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function tentar(texto) {
  try {
    const v = JSON.parse(texto);
    return ehObjeto(v) ? v : null;
  } catch {
    return null;
  }
}

/** Texto JSON (ou objeto) dos argumentos -> objeto; inválido -> { __argsInvalidos: trecho }. */
function lerArgumentos(valor) {
  if (valor === undefined || valor === null || valor === '') return {};
  if (typeof valor === 'object') return ehObjeto(valor) ? valor : { [MARCA]: JSON.stringify(valor).slice(0, MAX_TRECHO) };
  const texto = String(valor).trim();
  if (!texto) return {};
  const direto = tentar(texto);
  if (direto) return direto;
  // só depois de o JSON original falhar: tira a cerca de markdown e a vírgula antes de } ou ]
  const reparado = texto.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').replace(/,\s*([}\]])/g, '$1');
  return tentar(reparado) || { [MARCA]: texto.slice(0, MAX_TRECHO) };
}

module.exports = { lerArgumentos, MARCA };
