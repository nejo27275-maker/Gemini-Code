// src/tools/backup.js
// Item 2 do roadmap "top 1" (set/2026): antes o agente podia sobrescrever ou
// editar um arquivo existente sem deixar nenhum rastro do conteúdo anterior
// — se a mudança fosse ruim, não tinha como voltar atrás sem git (e nem todo
// projeto/pasta é um repo git). Agora, toda vez que write_file ou edit_file
// vão MODIFICAR um arquivo que já existia (não vale para criação de arquivo
// novo), o conteúdo antigo é salvo antes em ~/.gemini-code/backups,
// espelhando o caminho original, com timestamp — puramente aditivo, nunca
// apaga um backup anterior.
'use strict';

const fs = require('fs');
const path = require('path');
const { HOME_DIR } = require('../config');

const BACKUPS_DIR = path.join(HOME_DIR, 'backups');

// Quantos backups manter por arquivo (evita a pasta crescer sem limite em
// sessões longas de edição repetida do mesmo arquivo).
const MAX_BACKUPS_POR_ARQUIVO = 20;

// Ordem cronológica crescente. Sufixo "-N" (colisão no mesmo ms) é MAIS NOVO que
// o nome sem sufixo, mas na ordenação de texto "-" vem antes de "." — por isso o comparador.
function ordenarBackups(nomes) {
  const chave = (n) => {
    const m = n.replace(/\.bak$/, '').match(/^(.*?)(?:-(\d+))?$/);
    return [m[1], Number(m[2] || 0)];
  };
  return nomes.slice().sort((a, b) => {
    const [ta, na] = chave(a);
    const [tb, nb] = chave(b);
    return ta < tb ? -1 : ta > tb ? 1 : na - nb;
  });
}

function pastaBackupPara(resolvedPath) {
  // Espelha o caminho original dentro de BACKUPS_DIR, trocando "/" por "_"
  // pra não precisar recriar a árvore de diretórios inteira.
  let chave = resolvedPath.replace(/[/\\]/g, '_').replace(/^_+/, '');
  // v0.3.7: nomes de arquivo passam de 255 bytes em caminhos fundos (comum em
  // node_modules/projetos aninhados no Termux) — o mkdir falhava e o backup
  // sumia em silêncio. Acima de um limite seguro, usa o fim do caminho + hash.
  if (Buffer.byteLength(chave) > 200) {
    const hash = require('crypto').createHash('sha1').update(resolvedPath).digest('hex').slice(0, 12);
    chave = `${chave.slice(-150)}-${hash}`;
  }
  return path.join(BACKUPS_DIR, chave);
}

/**
 * Se `p` já existir como arquivo, salva uma cópia do conteúdo atual antes de
 * uma escrita/edição. Não faz nada se o arquivo ainda não existe (criação
 * nova não tem o que fazer backup). Nunca lança — um backup que falha não
 * deve impedir a operação principal.
 *
 * @returns {string|null} caminho do backup criado, ou null se não criou.
 */
function backupBeforeWrite(p) {
  try {
    const resolved = path.resolve(p);
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) return null;

    const pasta = pastaBackupPara(resolved);
    fs.mkdirSync(pasta, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    // v0.3.10: duas gravações no mesmo milissegundo geravam o mesmo nome e o
    // segundo backup SOBRESCREVIA o primeiro (perdendo uma versão). Sufixo evita.
    let destino = path.join(pasta, `${ts}.bak`);
    for (let n = 1; fs.existsSync(destino); n++) destino = path.join(pasta, `${ts}-${n}.bak`);
    fs.copyFileSync(resolved, destino);

    podarBackupsAntigos(pasta);
    return destino;
  } catch {
    // Backup é rede de segurança, não deve travar a operação principal.
    return null;
  }
}

function podarBackupsAntigos(pasta) {
  try {
    const arquivos = ordenarBackups(fs.readdirSync(pasta).filter((n) => n.endsWith('.bak')));
    const excesso = arquivos.length - MAX_BACKUPS_POR_ARQUIVO;
    if (excesso > 0) {
      for (const nome of arquivos.slice(0, excesso)) {
        fs.unlinkSync(path.join(pasta, nome));
      }
    }
  } catch { /* poda é best-effort */ }
}

// v0.3.8: os backups eram criados mas não havia como restaurá-los sem
// vasculhar ~/.gemini-code/backups à mão.
/** Lista os backups de um arquivo, do mais recente para o mais antigo. */
function listarBackups(p) {
  const pasta = pastaBackupPara(path.resolve(p));
  try {
    return ordenarBackups(fs.readdirSync(pasta).filter((n) => n.endsWith('.bak')))
      .reverse()
      .map((nome) => {
        const caminho = path.join(pasta, nome);
        return { nome, caminho, bytes: fs.statSync(caminho).size };
      });
  } catch {
    return [];
  }
}

/**
 * Restaura o backup número `n` (1 = o mais recente) sobre o arquivo.
 * O conteúdo atual é salvo como um novo backup antes — restaurar também
 * dá para desfazer.
 * @returns {{restaurado: string, backupDoAtual: string|null}}
 */
function restaurarBackup(p, n = 1) {
  const lista = listarBackups(p);
  if (!lista.length) throw new Error(`Nenhum backup encontrado para ${p}`);
  const idx = Math.floor(Number(n));
  if (!Number.isFinite(idx) || idx < 1 || idx > lista.length) {
    throw new Error(`Backup ${n} não existe (há ${lista.length}; use um número de 1 a ${lista.length}).`);
  }
  const alvo = lista[idx - 1];
  const destino = path.resolve(p);
  const backupDoAtual = backupBeforeWrite(destino);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.copyFileSync(alvo.caminho, destino);
  return { restaurado: alvo.nome, backupDoAtual };
}

module.exports = { backupBeforeWrite, BACKUPS_DIR, pastaBackupPara, listarBackups, restaurarBackup };
