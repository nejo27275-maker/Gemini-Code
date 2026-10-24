// src/redeSegura.js (v0.41.0)
// GET com o DNS FIXADO no endereço que foi checado. Antes o anti-SSRF (ensurePublicTarget) resolvia o
// nome, conferia o IP e depois o fetch resolvia de NOVO para conectar: um DNS do atacante com TTL 0
// responde um IP público na checagem e 127.0.0.1 / 169.254.169.254 na conexão (DNS rebinding).
// Aqui a conexão usa o `lookup` abaixo, que confere cada endereço no momento de conectar.
// Devolve um Response do fetch (status, headers.get, body.getReader/cancel); nunca segue redirecionamento.
'use strict';

const dns = require('dns');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { Readable } = require('stream');

const SEM_CORPO = new Set([101, 204, 205, 304]);

function erroPrivado(hostname, endereco) {
  const e = new Error(`${hostname} resolve para um IP privado/reservado (${endereco}) na hora de conectar.`);
  e.code = 'ERR_DESTINO_PRIVADO';
  return e;
}

/** `lookup` para http(s).request: recusa a conexão se QUALQUER endereço resolvido for privado. */
function lookupPublico(permitirPrivado = false) {
  return (hostname, options, callback) => {
    const opts = typeof options === 'object' && options ? options : { family: options };
    dns.lookup(hostname, { ...opts, all: true }, (err, enderecos) => {
      if (err) return callback(err);
      if (!permitirPrivado) {
        const { privateAddress } = require('./routineRunner');
        const ruim = enderecos.find((a) => privateAddress(a.address));
        if (ruim) return callback(erroPrivado(hostname, ruim.address));
      }
      if (opts.all) return callback(null, enderecos);
      return callback(null, enderecos[0].address, enderecos[0].family);
    });
  };
}

function descomprimir(res) {
  const enc = String(res.headers['content-encoding'] || '').trim().toLowerCase();
  if (enc === 'gzip' || enc === 'x-gzip') return res.pipe(zlib.createGunzip());
  if (enc === 'deflate') return res.pipe(zlib.createInflate());
  if (enc === 'br') return res.pipe(zlib.createBrotliDecompress());
  return res;
}

/**
 * @param {string} url
 * @param {{ headers?: object, signal?: AbortSignal, permitirPrivado?: boolean, method?: string }} opts
 * @returns {Promise<Response>}
 */
function fetchComDnsFixado(url, { headers = {}, signal, permitirPrivado = false, method = 'GET' } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const modulo = u.protocol === 'https:' ? https : u.protocol === 'http:' ? http : null;
    if (!modulo) return reject(new Error(`protocolo não suportado: ${u.protocol}`));
    let req;
    try {
      req = modulo.request(u, {
        method,
        headers: { 'accept-encoding': 'gzip, deflate, br', ...headers },
        signal,
        agent: false, // conexão nova: nada de socket reaproveitado que tenha sido aberto sem esta checagem
        lookup: lookupPublico(permitirPrivado),
      }, (res) => {
        const cabecalhos = new Headers();
        for (const [k, v] of Object.entries(res.headers)) for (const x of [].concat(v)) cabecalhos.append(k, String(x));
        let corpo = null;
        if (SEM_CORPO.has(res.statusCode) || method === 'HEAD') res.resume();
        else {
          const fluxo = descomprimir(res);
          if (fluxo !== res) res.on('error', (e) => fluxo.destroy(e));
          corpo = Readable.toWeb(fluxo);
        }
        try {
          resolve(new Response(corpo, { status: res.statusCode, statusText: res.statusMessage || '', headers: cabecalhos }));
        } catch (e) { res.destroy(); reject(e); }
      });
    } catch (e) { return reject(e); }
    req.on('error', reject);
    req.end();
  });
}

module.exports = { fetchComDnsFixado, lookupPublico };
