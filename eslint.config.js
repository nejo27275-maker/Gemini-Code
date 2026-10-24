// eslint.config.js (v0.43.3) — formato "flat config", o único que o ESLint 9 e 10 leem (o antigo
// .eslintrc.json era ignorado por eles). Mesmas regras de antes: as recomendadas do ESLint + os ajustes
// do projeto. As recomendadas vêm dos metadados das próprias regras do ESLint instalado (é exatamente o que
// o pacote @eslint/js publica), para não precisar de outra dependência. O ESLint não é dependência do
// projeto: o CI instala uma versão fixa só para esta checagem (ver .github/workflows/ci.yml).
'use strict';

const { builtinRules } = require('eslint/use-at-your-own-risk');

const recomendadas = {};
for (const [nome, regra] of builtinRules) {
  if (regra.meta && regra.meta.docs && regra.meta.docs.recommended) recomendadas[nome] = 'error';
}

const GLOBAIS_NODE = [
  'require', 'module', 'exports', '__dirname', '__filename', 'process', 'Buffer', 'console', 'global', 'globalThis',
  'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'setImmediate', 'clearImmediate', 'queueMicrotask',
  'URL', 'URLSearchParams', 'TextDecoder', 'TextEncoder', 'AbortController', 'AbortSignal', 'structuredClone',
  'fetch', 'Headers', 'Request', 'Response', 'FormData', 'Blob', 'WebSocket', 'performance',
];

module.exports = [
  { ignores: ['node_modules/', 'teste-design/', '**/*.min.js'] },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: Object.fromEntries(GLOBAIS_NODE.map((g) => [g, 'readonly'])),
    },
    rules: {
      ...recomendadas,
      'no-unused-vars': ['warn', { args: 'none' }],
      'no-console': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
];
