// src/limitador.js
// v0.43.0 — conta eventos por chave (normalmente o IP) numa janela de tempo. A memória é limitada: sob
// ataque vindo de muitos endereços o mapa não cresce sem fim — saem primeiro as janelas vencidas e, se
// ainda faltar espaço, a mais antiga. Usado pelo cowork (tentativas de token, mensagens por conexão) e
// pela API de rotinas (requisições e falhas de autenticação por IP).
'use strict';

/**
 * @param {{ max: number, janelaMs: number, maxChaves?: number, agora?: () => number }} opcoes
 */
function criarLimitador({ max, janelaMs, maxChaves = 10000, agora = Date.now } = {}) {
  if (!(max > 0) || !(janelaMs > 0) || !(maxChaves > 0)) throw new Error('criarLimitador: max, janelaMs e maxChaves precisam ser positivos.');
  const mapa = new Map(); // chave -> { inicio, n }; a ordem de inserção é a ordem de início das janelas

  function vigente(chave, t) {
    const r = mapa.get(chave);
    if (r && t - r.inicio >= janelaMs) { mapa.delete(chave); return null; }
    return r || null;
  }

  function abrirEspaco(t) {
    for (const [k, r] of mapa) {
      if (t - r.inicio < janelaMs) break; // as seguintes começaram depois: ainda valem
      mapa.delete(k);
    }
    if (mapa.size >= maxChaves) mapa.delete(mapa.keys().next().value);
  }

  return {
    /** Conta um evento; devolve true enquanto a chave não passou de `max` nesta janela. */
    registrar(chave) {
      const t = agora();
      let r = vigente(chave, t);
      if (!r) {
        if (mapa.size >= maxChaves) abrirEspaco(t);
        r = { inicio: t, n: 0 };
        mapa.set(chave, r);
      }
      r.n++;
      return r.n <= max;
    },
    /** true se a chave já atingiu `max` nesta janela (não conta nada). */
    bloqueado(chave) {
      const r = vigente(chave, agora());
      return Boolean(r && r.n >= max);
    },
    /** Milissegundos até a janela da chave acabar (0 se não há janela aberta). */
    restanteMs(chave) {
      const t = agora();
      const r = vigente(chave, t);
      return r ? janelaMs - (t - r.inicio) : 0;
    },
    get tamanho() { return mapa.size; },
  };
}

module.exports = { criarLimitador };
