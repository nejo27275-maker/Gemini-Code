'use strict';
// Verificador oculto. Uso: node check.js <workspace>
// Passa se: testes intactos e passando; calcularTotalPedido existe e se comporta igual; o nome
// antigo sumiu do código (comentários não contam); a isca recalcTotal continua (o teste usa).
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ws = process.argv[2];
const testeRel = path.join('test', 'loja.test.js');
assert.equal(fs.readFileSync(path.join(ws, testeRel), 'utf8'), fs.readFileSync(path.join(__dirname, 'workspace', testeRel), 'utf8'), 'o arquivo de teste não podia ser alterado');

const env = { ...process.env };
delete env.NODE_TEST_CONTEXT;
const r = spawnSync(process.execPath, ['--test', testeRel], { cwd: ws, encoding: 'utf8', timeout: 30000, env });
assert.equal(r.status, 0, `os testes do projeto falharam:\n${(r.stdout || '').slice(-1200)}`);

const pedido = require(path.join(ws, 'src', 'pedido.js'));
assert.equal(typeof pedido.calcularTotalPedido, 'function', 'calcularTotalPedido precisa ser exportada de src/pedido.js');
assert.equal(pedido.calcTotal, undefined, 'o nome antigo calcTotal não pode continuar exportado');
assert.equal(pedido.calcularTotalPedido([{ preco: 10, qtd: 3 }], 50), 15);
assert.equal(pedido.calcularTotalPedido([{ preco: 0.1, qtd: 3 }]), 0.3);

const semComentarios = (codigo) => codigo.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
for (const nome of fs.readdirSync(path.join(ws, 'src'))) {
  const codigo = semComentarios(fs.readFileSync(path.join(ws, 'src', nome), 'utf8'));
  assert.doesNotMatch(codigo, /\bcalcTotal\b/, `src/${nome} ainda usa calcTotal`);
}
console.log('ok');
