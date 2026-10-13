// src/code-ia/tokenizer.js
// Tokenizador PRÓPRIO do code-ia (nenhuma biblioteca externa, nenhum modelo de terceiros).
//   - palavras()       -> busca (BM25): minúsculas, sem acento, sem stopwords, sinônimos PT/EN,
//                         separa camelCase/snake_case (readFileSync -> ler arquivo sync)
//   - tokensDeCodigo() -> geração: preserva símbolos, espaços e quebras de linha
'use strict';

const STOPWORDS = new Set((
  'a o as os um uma uns umas de do da dos das em no na nos nas por para pra com sem sobre e ou mas que se ' +
  'eu voce vc me te meu minha seu sua como qual quais quando onde porque fazer faz faca quero preciso ' +
  'the an of to in on for with and or but is are be do does how what which when where why i you my your'
).split(/\s+/));

// Sinônimos/flexões -> raiz canônica. Vale tanto pro texto indexado quanto pra pergunta.
const SIN = {};
function grupo(raiz, ...formas) { for (const f of formas) SIN[f] = raiz; }
grupo('cri', 'criar', 'crie', 'cria', 'criando', 'criacao', 'create', 'make', 'build', 'novo', 'nova', 'gerar', 'gere', 'gera', 'generate');
grupo('ler', 'ler', 'leia', 'le', 'lendo', 'leitura', 'read', 'open', 'abrir', 'abra', 'abre');
grupo('escrev', 'escrever', 'escreva', 'escreve', 'gravar', 'grave', 'write');
grupo('salv', 'salvar', 'salve', 'salva', 'salvando', 'save', 'guardar', 'guarde', 'persistir');
grupo('rod', 'rodar', 'rode', 'roda', 'rodando', 'executar', 'execute', 'executa', 'run', 'exec', 'iniciar', 'inicie', 'start');
grupo('instal', 'instalar', 'instale', 'instala', 'install', 'instalacao');
grupo('apag', 'apagar', 'apague', 'deletar', 'delete', 'remover', 'remova', 'remove', 'excluir', 'exclua');
grupo('mostr', 'mostrar', 'mostre', 'mostra', 'exibir', 'exiba', 'imprimir', 'imprima', 'print', 'log', 'show');
grupo('esper', 'esperar', 'espere', 'aguardar', 'aguarde', 'sleep', 'delay', 'pausa', 'wait');
grupo('envi', 'enviar', 'envie', 'mandar', 'mande', 'send', 'post');
grupo('baix', 'baixar', 'baixe', 'download', 'baixando');
grupo('arquivo', 'arquivo', 'arquivos', 'file', 'files');
grupo('servidor', 'servidor', 'server', 'servidores');
grupo('erro', 'erro', 'erros', 'error', 'errors', 'bug', 'falha', 'falhou', 'exception');
grupo('lista', 'lista', 'listas', 'array', 'arrays', 'list');
grupo('botao', 'botao', 'botoes', 'button');
grupo('imagem', 'imagem', 'imagens', 'image', 'foto', 'picture');
grupo('requisicao', 'requisicao', 'request', 'fetch', 'http', 'api');
grupo('banco', 'banco', 'database', 'db', 'sqlite');
grupo('tempo', 'tempo', 'time', 'timer', 'temporizador', 'timeout', 'interval');

function semAcento(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/** Corte leve de sufixos (PT/EN) — suficiente pra "função/funções" ou "servers" casarem. */
function raiz(p) {
  if (p.length <= 4) return p;
  return p
    .replace(/(coes|cao|mente|ando|endo|indo|ados|adas|ado|ada|ing|ed|es|s)$/, '')
    .replace(/(ar|er|ir)$/, '') || p;
}

function emitir(p, out) {
  if (SIN[p]) { out.push(SIN[p]); return; }
  if (p.length < 2 || STOPWORDS.has(p)) return;
  out.push(raiz(p));
}

function palavras(texto) {
  const out = [];
  // palavra por palavra no texto ORIGINAL: camelCase vira partes E também a palavra inteira
  // (readFileSync -> ler arquivo sync + readfilesync; JavaScript -> java script + javascript)
  for (const w of semAcento(texto).match(/[A-Za-z0-9]+/g) || []) {
    const partes = w.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(' ');
    if (partes.length > 1) {
      emitir(w.toLowerCase(), out);
      for (const parte of partes) emitir(parte.toLowerCase(), out);
    } else {
      emitir(w.toLowerCase(), out);
    }
  }
  return out;
}

const RE_CODIGO = /\s+|[A-Za-z_$][A-Za-z0-9_$]*|\d+(?:\.\d+)?|=>|===|!==|==|!=|<=|>=|&&|\|\||\+\+|--|\.\.\.|[^\sA-Za-z0-9_$]/g;

function tokensDeCodigo(texto) {
  return String(texto || '').match(RE_CODIGO) || [];
}

module.exports = { palavras, tokensDeCodigo, semAcento, raiz, STOPWORDS };
