'use strict';
// Verificador oculto. Uso: node check.js <workspace>
// Exige que só a linha pedida mude: o resto do arquivo (inclusive os "iscas"
// TIMEOUT_UPLOAD_MS_LEGADO = 30000 e o comentário com 30000) fica byte a byte igual.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const rel = path.join('src', 'limites.js');
const antes = fs.readFileSync(path.join(__dirname, 'workspace', rel), 'utf8').split('\n');
const depois = fs.readFileSync(path.join(process.argv[2], rel), 'utf8').split('\n');

assert.equal(depois.length, antes.length, `o número de linhas mudou (${antes.length} -> ${depois.length})`);
const diferentes = antes.map((l, i) => (l === depois[i] ? null : i + 1)).filter(Boolean);
const alvo = antes.indexOf('const TIMEOUT_UPLOAD_MS = 30000;') + 1;
assert.deepEqual(diferentes, [alvo], `linhas alteradas: ${diferentes.join(', ') || 'nenhuma'} (esperado só a ${alvo})`);
assert.match(depois[alvo - 1], /^const TIMEOUT_UPLOAD_MS = 45_?000;$/, `linha ${alvo} ficou: ${depois[alvo - 1]}`);
console.log('ok');
