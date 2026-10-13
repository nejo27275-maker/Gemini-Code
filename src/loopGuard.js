// src/loopGuard.js (v0.32.0)
// Detecta o modelo preso repetindo a MESMA chamada de ferramenta com o MESMO resultado (ex.: ler o mesmo arquivo
// ou rodar o mesmo comando que sempre falha). Antes só existia o teto de 60 passos, que gasta muita cota até
// disparar. Aqui: na 3ª repetição idêntica o resultado ganha um aviso para mudar de abordagem; na 5ª o turno é
// encerrado. Só conta chamadas idênticas (nome + argumentos + resultado); mudou o resultado, o contador zera,
// então acompanhar um processo ("ver se terminou") não é punido enquanto a saída muda.
'use strict';

const crypto = require('crypto');

const AVISAR_EM = 3;
const PARAR_EM = 5;

function hash(s) { return crypto.createHash('sha1').update(String(s)).digest('hex'); }
function chave(nome, args) {
  let a;
  try { a = JSON.stringify(args ?? {}, Object.keys(args ?? {}).sort()); } catch { a = String(args); }
  return `${nome}|${a}`;
}

function criar({ avisarEm = AVISAR_EM, pararEm = PARAR_EM } = {}) {
  const vistos = new Map(); // chave da chamada -> { h: hash do resultado, n: repetições seguidas }
  return {
    /** @returns {{n:number, aviso:string|null, parar:boolean}} */
    registrar(nome, args, resultado) {
      const k = chave(nome, args);
      const h = hash(resultado);
      const atual = vistos.get(k);
      const n = atual && atual.h === h ? atual.n + 1 : 1;
      vistos.set(k, { h, n });
      if (n >= pararEm) {
        return { n, parar: true, aviso: `[loop] Esta mesma chamada (${nome}) já deu o mesmo resultado ${n} vezes. Encerrando o turno para não gastar mais cota.` };
      }
      if (n >= avisarEm) {
        return { n, parar: false, aviso: `[aviso] Você já fez esta mesma chamada (${nome}) ${n} vezes e o resultado não mudou. Mude de abordagem (outro comando, outro arquivo ou outros argumentos) ou explique ao usuário o que está bloqueando.` };
      }
      return { n, parar: false, aviso: null };
    },
  };
}

module.exports = { criar, AVISAR_EM, PARAR_EM };
