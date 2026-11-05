// src/tools/multiEditTools.js
// edit_files: várias edições (old_text -> new_text), em um ou mais arquivos, aplicadas
// de forma ATÔMICA. Com edit_file, uma refatoração em 5 arquivos virava 5 chamadas, e
// se a 4ª falhasse o projeto ficava pela metade (3 arquivos novos, 2 velhos), quebrando
// o build. Aqui tudo é validado e aplicado em memória primeiro; só grava se TODAS as
// edições derem certo, e se uma gravação falhar no meio, desfaz as que já foram.
//
// v0.50.0: edição de profissional. O motor (src/tools/edicao.js) mantém o fim de linha do arquivo (CRLF/LF), acha o
// trecho mesmo com espaço sobrando no fim das linhas (se for um lugar só) e, quando não acha, mostra o trecho mais
// parecido com os números de linha. O resultado traz o diff com números de linha; a sintaxe é conferida depois de
// gravar (src/tools/sintaxe.js); e um aviso diz se o arquivo tinha mudado no disco desde a última leitura do agente
// (src/tools/leituras.js). O edit_file usa este mesmo núcleo: editar(edicoes, { unica: true }).
'use strict';

const fs = require('fs');
const { backupBeforeWrite } = require('./backup');
const rewind = require('../rewind');
const leituras = require('./leituras');
const { aplicarUmaEdicao, resumoDiff } = require('./edicao');
const { isProtected, isSecret, arquivoQueRodaNoGit, confirmarForaDaArea, MSG_SEGREDO, MSG_GIT } = require('./protectedPaths');

const MAX_EDICOES = 50;
const MAX_ARQUIVOS = 20;
// Até 20 arquivos ficam na memória ao mesmo tempo (original + editado); no Termux a
// RAM é curta, e arquivo de texto editável à mão não passa disso.
const MAX_BYTES_ARQUIVO = 10 * 1024 * 1024;
// O diff que volta para o modelo: por arquivo e no total (o contexto do modelo é caro).
const MAX_LINHAS_DIFF = 40;
const MAX_LINHAS_DIFF_TOTAL = 120;

const declarations = [
  {
    name: 'edit_files',
    description:
      'Aplica várias edições de trecho exato (old_text -> new_text), em um ou mais arquivos existentes, ' +
      'de forma atômica: ou todas dão certo, ou nada é gravado. As edições rodam em ordem; duas no mesmo ' +
      'arquivo se somam (a segunda vê o resultado da primeira). Sem replace_all, cada old_text precisa ' +
      `aparecer exatamente uma vez. Máximo: ${MAX_EDICOES} edições e ${MAX_ARQUIVOS} arquivos por chamada. ` +
      'O resultado mostra o que mudou (diff com números de linha) e avisa se a edição quebrou a sintaxe.',
    parameters: {
      type: 'object',
      properties: {
        edits: {
          type: 'array',
          description: 'Edições, aplicadas na ordem dada',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'Caminho do arquivo (precisa existir)' },
              old_text: { type: 'string', description: 'Trecho exato a substituir (não vazio)' },
              new_text: { type: 'string', description: 'Texto que entra no lugar (vazio apaga o trecho)' },
              replace_all: { type: 'boolean', description: 'Se true, troca todas as ocorrências. Padrão: false (exige ocorrência única).' },
            },
            required: ['path', 'old_text', 'new_text'],
          },
        },
      },
      required: ['edits'],
    },
  },
];

// Erro de forma do trecho de UMA edição (sem I/O), ou null se está ok. Não olha
// "path": aplicarEdicoes só transforma o conteúdo de um arquivo já escolhido.
function validarTrecho(e) {
  if (!e || typeof e !== 'object' || Array.isArray(e)) return 'cada edição precisa ser um objeto { path, old_text, new_text }.';
  if (typeof e.old_text !== 'string' || e.old_text === '') return 'old_text não pode ser vazio — informe o trecho exato a substituir.';
  if (typeof e.new_text !== 'string') return 'falta "new_text" (pode ser string vazia para apagar o trecho).';
  // "false" em string é truthy: aceitar seria trocar tudo quando o modelo quis o contrário.
  if (e.replace_all !== undefined && typeof e.replace_all !== 'boolean') return 'replace_all precisa ser true ou false (booleano).';
  return null;
}

/**
 * Aplica, em ordem, as edições de UM arquivo sobre `conteudo`. Pura (sem I/O).
 * @returns {{ok: true, conteudo: string, ajustes?: string[]} | {ok: false, indice: number, erro: string}}
 *   `indice` é a posição (0-based) em `edicoesDoArquivo` da edição que falhou. `ajustes` (só quando houve): o que o
 *   motor adaptou (fim de linha, espaços no fim das linhas).
 */
function aplicarEdicoes(conteudo, edicoesDoArquivo) {
  let atual = String(conteudo);
  const ajustes = [];
  for (let i = 0; i < edicoesDoArquivo.length; i++) {
    const e = edicoesDoArquivo[i];
    const invalida = validarTrecho(e);
    if (invalida) return { ok: false, indice: i, erro: invalida };
    const r = aplicarUmaEdicao(atual, e);
    if (!r.ok) {
      // A causa mais comum de "não encontrado" na 2ª edição é uma edição anterior ter mudado o trecho.
      const lembrete = i > 0 && /não encontrado/.test(r.erro) ? ' Lembre: as edições anteriores neste arquivo já foram aplicadas ao conteúdo.' : '';
      return { ok: false, indice: i, erro: `${r.erro}${lembrete}${r.dica ? `\n${r.dica}\n` : ''}` };
    }
    atual = r.texto;
    if (r.ajuste && !ajustes.includes(r.ajuste)) ajustes.push(r.ajuste);
  }
  return ajustes.length ? { ok: true, conteudo: atual, ajustes } : { ok: true, conteudo: atual };
}

// Lê e valida um arquivo. Devolve { arquivo } ou { erro } (mensagem sem o prefixo da edição).
function carregar(p) {
  let st;
  try {
    st = fs.statSync(p);
  } catch (err) {
    return { erro: err.code === 'ENOENT' ? 'arquivo não existe (só dá para editar arquivos que existem; use write_file para criar).' : `não deu para acessar o arquivo (${err.code || err.message}).` };
  }
  if (st.isDirectory()) return { erro: 'é um diretório, não um arquivo.' };
  if (!st.isFile()) return { erro: 'não é um arquivo regular.' };
  if (st.size > MAX_BYTES_ARQUIVO) return { erro: `tem ${st.size} bytes (limite da edição: ${MAX_BYTES_ARQUIVO}).` };
  let abs;
  let original;
  try {
    // Grava no caminho REAL resolvido agora: se um symlink fosse trocado entre a
    // checagem de proteção e a gravação, escrever pelo link acertaria outro arquivo.
    abs = fs.realpathSync(p);
    original = fs.readFileSync(abs);
  } catch (err) {
    return { erro: `não deu para ler o arquivo (${err.code || err.message}).` };
  }
  // Heurística simples de binário (a mesma do read_file): byte nulo nos primeiros 8000 bytes.
  if (original.subarray(0, 8000).includes(0)) return { erro: 'parece ser um arquivo binário — não editado como texto.' };
  const texto = original.toString('utf8');
  // Arquivo em Latin-1 (comum em projeto antigo) viraria "�" nos acentos FORA do trecho
  // editado ao ser regravado como UTF-8. Melhor recusar do que corromper em silêncio.
  if (!Buffer.from(texto, 'utf8').equals(original)) return { erro: 'não é UTF-8 válido (ex.: Latin-1) — regravar como texto corromperia os acentos.' };
  // dev:ino junta o mesmo arquivo pedido por caminhos diferentes (symlink, hard link):
  // senão cada alias seria editado a partir do original e a última gravação apagaria as outras.
  const chave = st.ino ? `${st.dev}:${st.ino}` : abs;
  return { arquivo: { chave, abs, original, texto, exibir: p, edicoes: [] } };
}

// Desfaz a gravação de um arquivo. Só regrava se o conteúdo mudou: se a falha foi ao
// abrir (EACCES), regravar falharia de novo e acusaria um problema que não existe.
function restaurar(arq) {
  try {
    if (fs.readFileSync(arq.abs).equals(arq.original)) return true;
  } catch { /* segue e tenta regravar */ }
  try {
    fs.writeFileSync(arq.abs, arq.original);
    return true;
  } catch {
    return false;
  }
}

const plural = (n) => (n === 1 ? '1 edição' : `${n} edições`);

/**
 * O núcleo do edit_files e do edit_file. `unica`: mensagens do edit_file (sem "edição 1 de 1").
 * @returns {Promise<string>} o resultado para o modelo
 */
async function editar(edits, { unica = false } = {}) {
  if (!Array.isArray(edits) || !edits.length) return 'Erro: edit_files precisa de "edits" (lista não vazia de { path, old_text, new_text }).';
  if (edits.length > MAX_EDICOES) return `Erro: edit_files aceita no máximo ${MAX_EDICOES} edições por chamada (recebeu ${edits.length}). Divida em mais chamadas. Nada foi gravado.`;

  const total = edits.length;
  const rotulo = (i) => `edição ${i + 1} de ${total}${edits[i] && typeof edits[i].path === 'string' ? ` (${edits[i].path})` : ''}`;
  const erro = (i, msg) => (unica ? `Erro: ${msg} Nada foi gravado.` : `Erro: ${rotulo(i)}: ${msg} Nada foi gravado.`);

  // 1) Forma de todas as edições antes de qualquer I/O.
  for (let i = 0; i < total; i++) {
    const e = edits[i];
    const invalida = validarTrecho(e) || (typeof e.path !== 'string' || !e.path ? 'falta "path".' : null);
    if (invalida) return erro(i, invalida);
  }

  // 2) Segurança e leitura (uma vez por arquivo), na ordem das edições.
  const porCaminho = new Map(); // caminho pedido -> arquivo (evita stat/leitura repetidos)
  const porChave = new Map(); // dev:ino -> arquivo
  for (let i = 0; i < total; i++) {
    const p = edits[i].path;
    let arq = porCaminho.get(p);
    if (!arq) {
      // Segredo primeiro: editar exige LER o arquivo, e esses nem leitura podem ter.
      if (isSecret(p)) return unica ? MSG_SEGREDO : `${MSG_SEGREDO} Recusado na ${rotulo(i)}; nada foi gravado.`;
      if (isProtected(p)) {
        const msg = 'este arquivo (ou o destino deste link) é configuração protegida do próprio gemini-code (config, MCP, hooks, token ou agente pessoal) e não pode ser editado diretamente.';
        return unica ? `Bloqueado: ${msg}` : `Bloqueado: ${rotulo(i)}: ${msg} Nada foi gravado.`;
      }
      if (arquivoQueRodaNoGit(p)) return unica ? MSG_GIT : `${MSG_GIT} Recusado na ${rotulo(i)}; nada foi gravado.`;
      const r = carregar(p);
      if (r.erro) return erro(i, r.erro);
      arq = porChave.get(r.arquivo.chave);
      if (!arq) {
        if (porChave.size >= MAX_ARQUIVOS) return erro(i, `passa do limite de ${MAX_ARQUIVOS} arquivos distintos por chamada. Divida em mais chamadas.`);
        arq = r.arquivo;
        porChave.set(arq.chave, arq);
      }
      porCaminho.set(p, arq);
    }
    arq.edicoes.push({ ...edits[i], global: i });
  }

  // 3) Aplica em memória. Se mais de um arquivo falhar, aponta a edição que vem primeiro.
  let falha = null;
  for (const arq of porChave.values()) {
    const r = aplicarEdicoes(arq.texto, arq.edicoes);
    if (r.ok) {
      arq.novo = r.conteudo;
      arq.ajustes = r.ajustes || [];
    } else {
      const global = arq.edicoes[r.indice].global;
      if (!falha || global < falha.global) falha = { global, erro: r.erro };
    }
  }
  if (falha) return erro(falha.global, falha.erro);

  // v0.45.0: uma pergunta só para todos os arquivos fora da pasta do projeto (src/tools/protectedPaths.js).
  const recusa = await confirmarForaDaArea([...porChave.values()].filter((a) => a.novo !== a.texto).map((a) => a.abs));
  if (recusa) return `${recusa} Nada foi gravado.`;

  // 4) Grava. Uma falha no meio (disco cheio, permissão) desfaz o que já foi gravado.
  const tentados = [];
  for (const arq of porChave.values()) {
    if (arq.novo === arq.texto) continue;
    // v0.50.0: o arquivo mudou no disco desde a última leitura/gravação do agente? (aviso; a troca é no conteúdo atual)
    arq.mudouDesdeLeitura = leituras.situacao(arq.abs, arq.original) === 'mudou';
    rewind.registrar(arq.abs);
    arq.backup = backupBeforeWrite(arq.abs);
    tentados.push(arq);
    try {
      fs.writeFileSync(arq.abs, arq.novo, 'utf8');
    } catch (err) {
      const naoRestaurados = tentados.filter((a) => !restaurar(a));
      const ok = tentados.length - naoRestaurados.length;
      let msg = `Erro: falha ao gravar ${arq.exibir} (${err.code || err.message}). ` +
        `Gravação desfeita: ${ok} arquivo(s) voltaram ao conteúdo original.`;
      for (const a of naoRestaurados) {
        msg += `\nATENÇÃO: não deu para restaurar ${a.exibir} — o conteúdo anterior está em ${a.backup || '(sem backup)'}.`;
      }
      return msg;
    }
    leituras.registrar(arq.abs, arq.novo);
  }

  // 5) O resultado: por arquivo, o que mudou (diff com números de linha) e o que conferir.
  const { conferirDepoisDeEditar } = require('./sintaxe');
  const linhas = [];
  let orcamento = MAX_LINHAS_DIFF_TOTAL;
  for (const arq of porChave.values()) {
    if (arq.novo === arq.texto) {
      linhas.push(`Sem mudança: ${arq.exibir} (${plural(arq.edicoes.length)}; o resultado é igual ao original, nada gravado)`);
      continue;
    }
    const diff = resumoDiff(arq.texto, arq.novo, { maxLinhas: Math.max(8, Math.min(MAX_LINHAS_DIFF, orcamento)) });
    orcamento -= diff.texto.split('\n').length;
    const backup = arq.backup ? `backup do conteúdo anterior em ${arq.backup}` : 'sem backup';
    // a 1ª linha mantém o formato de antes (quem lê o caminho do backup no fim dela continua funcionando)
    linhas.push(unica ? `Editado: ${arq.exibir} (${backup})` : `Editado: ${arq.exibir} (${plural(arq.edicoes.length)}; ${backup})`);
    for (const a of arq.ajustes) linhas.push(`Nota: ${a}.`);
    if (arq.mudouDesdeLeitura) linhas.push('Aviso: este arquivo tinha mudado no disco desde a última vez que você o leu (outra pessoa ou um comando mexeu); a troca foi feita no conteúdo atual — confira o trecho abaixo.');
    if (diff.texto) linhas.push(diff.texto);
    const sintaxe = await conferirDepoisDeEditar(arq.exibir, arq.texto, arq.novo);
    if (sintaxe) linhas.push(sintaxe);
  }
  return linhas.join('\n');
}

async function execute(name, args) {
  if (name !== 'edit_files') throw new Error(`Ferramenta de edição múltipla desconhecida: ${name}`);
  return editar(args && args.edits);
}

module.exports = { declarations, execute, editar, aplicarEdicoes, validarTrecho, MAX_EDICOES, MAX_ARQUIVOS, MAX_BYTES_ARQUIVO };
