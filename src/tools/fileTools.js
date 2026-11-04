// src/tools/fileTools.js
'use strict';

const fs = require('fs');
const path = require('path');
const { backupBeforeWrite } = require('./backup');
const rewind = require('../rewind');
const leituras = require('./leituras');
const { isProtected, isSecret, foraDoProjetoParaConvidado, arquivoQueRodaNoGit, confirmarForaDaArea, MSG_SEGREDO, MSG_GIT } = require('./protectedPaths');

// Achado num teste (set/2026): o agente reescreveu sozinho o config.json
// (model/fastModel/imageModel) sem o usuário pedir nem confirmar, voltando
// pra modelos sem cota grátis / já descontinuados que já tinham sido
// corrigidos antes. write_file não tinha nenhuma trava — qualquer arquivo
// valia, incluindo a própria config do gemini-code. Agora esses arquivos
// são protegidos: nem o modelo consegue escrever neles direto, só via
// "gemini-code config set-*" (uma ação explícita do usuário).
//
// v0.40.0: a lista (src/config.js) passou a incluir hooks.json — gravá-lo dava
// ao modelo comandos rodando via `sh -c` a cada ferramenta, sem confirmação —
// e os tokens. A comparação era por path.resolve, então um symlink de dentro
// de um repositório clonado (ex.: docs/settings.json -> ~/.gemini-code/config.json)
// passava direto; agora compara o caminho REAL (symlinks resolvidos, inclusive
// quebrados, e pastas que são symlink) e o inode (hard link) — src/tools/protectedPaths.js.
// v0.41.0: read_file também recusa os segredos (SECRET_PATHS).

// Achado num teste (set/2026, itens 1 e 2 da revisão): read_file não tinha
// limite de tamanho nem tratamento de erro — um arquivo binário grande (ex.:
// uma imagem ou um .zip) enchia o histórico de lixo e podia estourar a cota
// de contexto do modelo numa tacada só; e um caminho inexistente ou uma
// pasta passada por engano derrubavam a chamada com uma exceção crua
// ("ENOENT..."), sem contexto nenhum pro modelo entender o que fazer a
// seguir. Agora: checa existência e tipo antes de ler, detecta binário
// olhando os primeiros bytes, e trunca com aviso explícito em vez de
// silencioso.
const MAX_READ_CHARS = 200 * 1024; // 200 KB de texto
// v0.3.8: readFileSync carregava arquivos gigantes (logs de GB) inteiros na memória só para truncar depois.
const MAX_READ_BYTES = 50 * 1024 * 1024;
const MAX_LIST_ENTRIES = 500;

// v0.3.6: a mensagem de truncamento já mandava "leia em partes", mas não
// existia nenhum jeito de ler em partes — o modelo ficava sem saída em
// arquivos grandes. Intervalo 1-based e inclusivo, linhas numeradas para o
// modelo conseguir apontar exatamente onde editar.
function lerIntervalo(text, args) {
  const linhas = text.split('\n');
  const total = linhas.length;
  const ini = args.start_line == null ? 1 : Math.floor(Number(args.start_line));
  const fim = args.end_line == null ? total : Math.floor(Number(args.end_line));
  if (Number.isFinite(ini) && ini > total) return `Erro: start_line (${ini}) passa do fim do arquivo, que tem ${total} linhas.`;
  if (!Number.isFinite(ini) || !Number.isFinite(fim) || ini < 1 || fim < ini) {
    return `Erro: intervalo inválido (start_line=${args.start_line}, end_line=${args.end_line}). Use inteiros com 1 <= start_line <= end_line.`;
  }
  const ate = Math.min(fim, total);
  const largura = String(ate).length;
  let saida = linhas
    .slice(ini - 1, ate)
    .map((l, i) => `${String(ini + i).padStart(largura)}\t${l}`)
    .join('\n');
  if (saida.length > MAX_READ_CHARS) {
    saida = saida.slice(0, MAX_READ_CHARS) + '\n[... trecho truncado: peça um intervalo menor]';
  }
  return `${saida}\n[linhas ${ini}-${ate} de ${total}]`;
}

const declarations = [
  {
    name: 'read_file',
    description:
      'Lê o conteúdo de um arquivo de texto do disco. Para arquivos grandes, use start_line/end_line ' +
      '(1-based, inclusivo) para ler só um trecho; com um intervalo, as linhas voltam numeradas.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Caminho do arquivo' },
        start_line: { type: 'integer', description: 'Primeira linha a ler (1 = início do arquivo)' },
        end_line: { type: 'integer', description: 'Última linha a ler (inclusiva)' },
      },
      required: ['path'],
    },
  },
  {
    name: 'write_file',
    description:
      'Cria um arquivo de texto, ou sobrescreve um inteiro. Para sobrescrever um arquivo que já existe, leia-o antes ' +
      'com read_file (senão a gravação é recusada); para mudar só um trecho, prefira edit_file. Mantém o fim de ' +
      'linha (CRLF) e o BOM do arquivo; o resultado mostra o que mudou e avisa se a sintaxe quebrou.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        content: { type: 'string' },
      },
      required: ['path', 'content'],
    },
  },
  {
    name: 'edit_file',
    description:
      'Substitui um trecho exato (old_text) por new_text num arquivo existente, sem reescrever ' +
      'o arquivo inteiro. old_text precisa ocorrer exatamente uma vez no arquivo — inclua contexto ' +
      'suficiente (linhas ao redor) para garantir isso — ou use replace_all: true para trocar todas. ' +
      'O resultado mostra o trecho alterado com números de linha e avisa se a edição quebrou a sintaxe.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        old_text: { type: 'string', description: 'Trecho exato a ser substituído (deve ser único no arquivo)' },
        new_text: { type: 'string', description: 'Texto que entra no lugar' },
        replace_all: { type: 'boolean', description: 'Se true, troca todas as ocorrências (ex.: renomear). Padrão: false.' },
      },
      required: ['path', 'old_text', 'new_text'],
    },
  },
  {
    name: 'list_dir',
    description: 'Lista arquivos e pastas de um diretório.',
    parameters: {
      type: 'object',
      properties: { path: { type: 'string', description: 'Diretório (padrão: .)' } },
    },
  },
];

// v0.45.1: falha do sistema ao gravar (pasta sem permissão, disco cheio, nome comprido demais, destino que é uma
// pasta) virava um erro cru do Node; agora diz o motivo em português e o que fazer.
const MOTIVOS_GRAVACAO = {
  EACCES: 'sem permissão para gravar ali', EPERM: 'sem permissão para gravar ali', EROFS: 'o disco ali é só leitura',
  ENOSPC: 'o disco está cheio', ENAMETOOLONG: 'o nome do arquivo (ou do caminho) é comprido demais',
  EISDIR: 'o destino é uma pasta, não um arquivo', ENOTDIR: 'uma parte do caminho é um arquivo, não uma pasta',
  EEXIST: 'já existe um arquivo com esse nome no lugar de uma pasta do caminho',
};
function erroDeGravacao(alvo, err) {
  const motivo = MOTIVOS_GRAVACAO[err && err.code] || (err && err.message) || String(err);
  return `Erro: não deu para gravar ${alvo}: ${motivo}${err && err.code ? ` (${err.code})` : ''}. Nada foi alterado nesse arquivo.`;
}

async function execute(name, args) {
  switch (name) {
    case 'read_file': {
      // v0.3.8: path ausente fazia path.resolve lançar um TypeError cru.
      if (typeof args.path !== 'string' || !args.path) return 'Erro: read_file precisa de "path".';
      if (isSecret(args.path)) return MSG_SEGREDO;
      const foraR = foraDoProjetoParaConvidado(args.path);
      if (foraR) return foraR;
      const p = path.resolve(args.path);
      if (!fs.existsSync(p)) return `Erro: arquivo não existe: ${args.path}`;
      const stat = fs.statSync(p);
      if (stat.isDirectory()) return `Erro: "${args.path}" é um diretório, não um arquivo — use list_dir.`;
      if (stat.size > MAX_READ_BYTES) {
        return `Erro: "${args.path}" tem ${stat.size} bytes (limite de leitura: ${MAX_READ_BYTES}). Use search_files ou run_shell (ex.: sed -n '1,200p' arquivo) para ver só um trecho.`;
      }
      const buf = fs.readFileSync(p);
      // Heurística simples de binário: byte nulo nos primeiros 8000 bytes.
      if (buf.subarray(0, 8000).includes(0)) {
        leituras.registrar(p, buf); // o agente viu o que há ali (um binário): sobrescrever vira decisão consciente
        return `Erro: "${args.path}" parece ser um arquivo binário (${stat.size} bytes) — não lido como texto.`;
      }
      const text = buf.toString('utf8');
      leituras.registrar(p, buf); // v0.50.0: o write_file só sobrescreve o que o agente já leu (src/tools/leituras.js)
      if (args.start_line != null || args.end_line != null) {
        return lerIntervalo(text, args);
      }
      if (text.length > MAX_READ_CHARS) {
        return (
          text.slice(0, MAX_READ_CHARS) +
          `\n\n[... arquivo truncado: mostrando os primeiros ${MAX_READ_CHARS} de ${text.length} caracteres. ` +
          'Use search_files ou read_file com start_line/end_line para ler o resto.]'
        );
      }
      return text;
    }
    case 'write_file': {
      if (typeof args.path !== 'string' || !args.path) return 'Erro: write_file precisa de "path".';
      // Antes, um `content` ausente gravava a string "undefined" no arquivo.
      if (typeof args.content !== 'string') return 'Erro: write_file precisa de "content" (texto). Nada foi gravado.';
      if (isProtected(args.path)) {
        return (
          'Bloqueado: este arquivo (ou o destino deste link) é configuração protegida do próprio ' +
          'gemini-code — config.json, mcp.json, hooks.json, um token de acesso ou um agente pessoal ' +
          '(~/.gemini-code/aliados) — e não pode ser sobrescrito por write_file. Para mudar ' +
          'model/fastModel/imageModel/etc, peça ao usuário para rodar "gemini-code config set-model NOME" ' +
          '(ou o subcomando equivalente); hooks, MCP e agentes pessoais (gemini-code aliados editar) só o ' +
          'próprio usuário edita. Para guardar algo na memória de um agente pessoal, use memory_save.'
        );
      }
      if (arquivoQueRodaNoGit(args.path)) return MSG_GIT;
      // v0.50.0: como um editor profissional — não sobrescreve o que não leu (nem o que mudou depois da leitura),
      // mantém o fim de linha e o BOM do arquivo, e mostra o que mudou.
      const p = path.resolve(args.path);
      let atual = null;
      let stW = null;
      try { stW = fs.statSync(p); } catch { /* arquivo novo */ }
      if (stW && stW.isFile()) {
        // o mesmo limite do read_file: um arquivo que o agente não consegue ler, ele também não sobrescreve inteiro
        if (stW.size > MAX_READ_BYTES) return `Erro: ${args.path} tem ${stW.size} bytes; o write_file não sobrescreve um arquivo desse tamanho (o limite é ${MAX_READ_BYTES}). Nada foi gravado.`;
        try { atual = fs.readFileSync(p); } catch (err) { return erroDeGravacao(args.path, err); }
      }
      let conteudo = args.content;
      const ajustes = [];
      if (atual && atual.length) {
        const textoAtual = atual.toString('utf8');
        const { fimDeLinha, paraCRLF, contarLinhas } = require('./edicao');
        if (fimDeLinha(textoAtual) === '\r\n' && /(^|[^\r])\n/.test(conteudo)) {
          conteudo = paraCRLF(conteudo);
          ajustes.push('o fim de linha CRLF (Windows) do arquivo foi mantido');
        }
        if (textoAtual.startsWith('\uFEFF') && !conteudo.startsWith('\uFEFF')) {
          conteudo = `\uFEFF${conteudo}`;
          ajustes.push('o BOM do início do arquivo foi mantido');
        }
        if (Buffer.from(conteudo, 'utf8').equals(atual)) {
          leituras.registrar(p, atual);
          return `Sem mudança: ${args.path} (o conteúdo é igual ao que já está no arquivo; nada gravado)`;
        }
        const visto = leituras.situacao(p, atual);
        if (visto === 'nunca') {
          const n = contarLinhas(textoAtual);
          return `Erro: ${args.path} já existe (${n} ${n === 1 ? 'linha' : 'linhas'}) e você não leu este arquivo nesta sessão. ` +
            'Leia com read_file antes de sobrescrever (para não apagar o que está nele), ou use edit_file/edit_files para mudar só um trecho. Nada foi gravado.';
        }
        if (visto === 'mudou') {
          return `Erro: ${args.path} mudou no disco depois da última vez que você o leu (outra pessoa, um comando ou um programa mexeu). ` +
            'Leia de novo com read_file antes de sobrescrever, para não apagar essas mudanças. Nada foi gravado.';
        }
      }
      // v0.45.0: fora da pasta do projeto (ex.: ~/.bashrc), pergunta antes — src/tools/protectedPaths.js
      const recusaW = await confirmarForaDaArea([args.path]);
      if (recusaW) return recusaW;
      let backupW;
      try {
        fs.mkdirSync(path.dirname(p), { recursive: true });
        rewind.registrar(args.path);
        backupW = backupBeforeWrite(args.path);
        fs.writeFileSync(args.path, conteudo, 'utf8');
      } catch (err) {
        return erroDeGravacao(args.path, err);
      }
      leituras.registrar(p, conteudo);
      const linhasNovas = require('./edicao').contarLinhas(conteudo);
      const partes = [];
      let diffTexto = '';
      if (atual && atual.length) {
        const diff = require('./edicao').resumoDiff(atual.toString('utf8'), conteudo, { maxLinhas: 40 });
        diffTexto = diff.texto;
        partes.push(`Arquivo salvo: ${args.path} (substituiu o conteúdo anterior: +${diff.mais} -${diff.menos} linhas` +
          `${backupW ? `; backup do conteúdo anterior em ${backupW}` : ''})`);
      } else {
        partes.push(`Arquivo salvo: ${args.path} (arquivo novo, ${linhasNovas} ${linhasNovas === 1 ? 'linha' : 'linhas'})`);
      }
      for (const a of ajustes) partes.push(`Nota: ${a}.`);
      if (diffTexto) partes.push(diffTexto);
      const sintaxe = await require('./sintaxe').conferirDepoisDeEditar(args.path, atual && atual.length ? atual.toString('utf8') : null, conteudo);
      if (sintaxe) partes.push(sintaxe);
      return partes.join('\n');
    }
    case 'edit_file': {
      if (typeof args.path !== 'string' || !args.path) return 'Erro: edit_file precisa de "path".';
      // v0.50.0: o mesmo núcleo do edit_files (src/tools/multiEditTools.js): fim de linha mantido, espaços no fim
      // das linhas tolerados, trecho mais parecido quando não acha, diff com números de linha e sintaxe conferida.
      const edicao = { path: args.path, old_text: args.old_text, new_text: args.new_text };
      if (args.replace_all !== undefined) edicao.replace_all = args.replace_all;
      return require('./multiEditTools').editar([edicao], { unica: true });
    }
    case 'list_dir': {
      const dir = args.path || '.';
      const foraL = foraDoProjetoParaConvidado(dir);
      if (foraL) return foraL;
      if (!fs.existsSync(dir)) return `Erro: diretório não existe: ${dir}`;
      if (!fs.statSync(dir).isDirectory()) return `Erro: "${dir}" não é um diretório.`;
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      if (!entries.length) return '(vazio)';
      const nomes = entries
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort((a, b) => (a.endsWith('/') === b.endsWith('/') ? a.localeCompare(b) : a.endsWith('/') ? -1 : 1));
      // v0.3.8: pastas com milhares de itens (node_modules, cache) enchiam o contexto.
      if (nomes.length > MAX_LIST_ENTRIES) {
        return nomes.slice(0, MAX_LIST_ENTRIES).join('\n') + `\n[... mostrando ${MAX_LIST_ENTRIES} de ${nomes.length} itens]`;
      }
      return nomes.join('\n');
    }
    default:
      throw new Error(`Ferramenta de arquivo desconhecida: ${name}`);
  }
}

module.exports = { declarations, execute, isProtected };
