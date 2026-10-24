'use strict';
// v0.41.0: a proteção anti-SSRF (rotinas e web_fetch) comparava prefixos de texto do IPv6 e deixava
// passar IPv4 privado embutido: NAT64, IPv4-compatível, 6to4 e formas expandidas.
const test = require('node:test');
const assert = require('node:assert/strict');
const { privateAddress, ensurePublicTarget } = require('../src/routineRunner');

const BLOQUEAR = {
  'NAT64 → 127.0.0.1': '64:ff9b::7f00:1',
  'NAT64 → metadata da nuvem': '64:ff9b::a9fe:a9fe',
  'NAT64 → 10.0.0.1': '64:ff9b::a00:1',
  'NAT64 de uso local': '64:ff9b:1::a00:1',
  'IPv4-compatível ::7f00:1': '::7f00:1',
  'IPv4-compatível com pontos': '::127.0.0.1',
  'SIIT': '::ffff:0:7f00:1',
  '6to4 → 127.0.0.1': '2002:7f00:1::1',
  '6to4 → 10.0.0.1': '2002:a00:1::1',
  'mapeado expandido': '0:0:0:0:0:ffff:7f00:1',
  'mapeado com pontos': '::ffff:192.168.0.10',
  'loopback expandido': '0:0:0:0:0:0:0:1',
  'não especificado': '::',
  'loopback': '::1',
  'ULA': 'fd12:3456::1',
  'link-local com zona': 'fe80::1%eth0',
  'site-local': 'fec0::1',
  'multicast': 'ff02::1',
  'documentação': '2001:db8::1',
  'Teredo': '2001:0:4136:e378::1',
};
const LIBERAR = {
  'Google DNS v6': '2001:4860:4860::8888',
  'Cloudflare v6': '2606:4700:4700::1111',
  'NAT64 → 8.8.8.8 (público)': '64:ff9b::808:808',
  'mapeado público': '::ffff:8.8.8.8',
};

test('IPv6 com IPv4 privado embutido é bloqueado', () => {
  for (const [nome, ip] of Object.entries(BLOQUEAR)) assert.equal(privateAddress(ip), true, `${nome} (${ip})`);
});

test('IPv6 público continua liberado (sem falso positivo)', () => {
  for (const [nome, ip] of Object.entries(LIBERAR)) assert.equal(privateAddress(ip), false, `${nome} (${ip})`);
  for (const ip of ['8.8.8.8', '1.1.1.1', '142.250.0.1']) assert.equal(privateAddress(ip), false, ip);
});

test('ensurePublicTarget recusa as mesmas formas escritas na URL', async () => {
  for (const u of ['http://[64:ff9b::7f00:1]/', 'http://[::7f00:1]/', 'http://[2002:a00:1::1]/', 'http://[64:ff9b::a9fe:a9fe]/latest/meta-data']) {
    await assert.rejects(ensurePublicTarget(u, false), /privado|reservado/, u);
  }
});

// Revisão adversarial da v0.41.0: a checagem resolvia o nome e o fetch resolvia DE NOVO ao conectar (DNS
// rebinding). Rotinas e web_fetch agora conectam pelo endereço conferido (src/redeSegura.js).
test('rotina http-check: o IP da conexão também é conferido (DNS rebinding)', async () => {
  const http = require('http');
  const dns = require('dns');
  const { executeHttpCheck } = require('../src/routineRunner');
  let pedidos = 0;
  const servidor = http.createServer((req, res) => { pedidos++; res.end('ok'); });
  await new Promise((ok) => servidor.listen(0, '127.0.0.1', ok));
  const original = { lookup: dns.lookup, promises: dns.promises.lookup };
  dns.promises.lookup = async () => [{ address: '93.184.215.14', family: 4 }]; // na checagem: público
  dns.lookup = (host, opts, cb) => { // na conexão: local
    const callback = typeof opts === 'function' ? opts : cb;
    if (host !== 'rebind.teste') return original.lookup(host, opts, cb);
    return opts && opts.all ? callback(null, [{ address: '127.0.0.1', family: 4 }]) : callback(null, '127.0.0.1', 4);
  };
  try {
    await assert.rejects(executeHttpCheck({ url: `http://rebind.teste:${servidor.address().port}/`, timeoutMs: 3000, expectedStatus: null }, { allowPrivateTargets: false }),
      /rebind\.teste resolve para um IP privado\/reservado \(127\.0\.0\.1\) na hora de conectar/);
    assert.equal(pedidos, 0, 'o serviço local não pode ter recebido a requisição');
  } finally {
    dns.lookup = original.lookup;
    dns.promises.lookup = original.promises;
    await new Promise((ok) => servidor.close(ok));
  }
});
