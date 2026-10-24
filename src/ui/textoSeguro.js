// src/ui/textoSeguro.js
// v0.43.2 — texto vindo do modelo, de um arquivo ou de um servidor, mostrado numa PERGUNTA DE CONFIRMAÇÃO,
// sem deixar o terminal interpretá-lo. As confirmações (run_shell, adb, MCP, /passo, memória...) são a
// principal barreira de segurança do gemini-code, e o texto ia cru para o terminal: um comando com "\r"
// (volta ao começo da linha) e "ESC[2K" (apaga a linha) sumia da tela — o usuário lia "npm test" e
// confirmava outra coisa. Também os caracteres de direção bidirecional (U+202A–U+202E, U+2066–U+2069),
// que reordenam o texto exibido ("Trojan Source").
//
// paraExibir: controles C0/C1 viram \xNN visível (menos \n e \t); controles de direção viram <U+XXXX>;
// mais de 2 linhas em branco seguidas viram um aviso (senão dava para empurrar a parte perigosa para
// fora da tela com centenas de linhas vazias).
'use strict';

// C0 sem \t (09) e \n (0a), DEL e C1 (80–9f). \r (0d) e ESC (1b) estão aqui.
// eslint-disable-next-line no-control-regex
const CONTROLES = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
const DIRECAO = /[؜‎‏‪-‮⁦-⁩]/g;
const MAX_BRANCAS = 2;

const hex = (c, n) => c.charCodeAt(0).toString(16).toUpperCase().padStart(n, '0');

function paraExibir(texto) {
  const limpo = String(texto ?? '')
    .replace(CONTROLES, (c) => `\\x${hex(c, 2)}`)
    .replace(DIRECAO, (c) => `<U+${hex(c, 4)}>`);
  const linhas = limpo.split('\n');
  const out = [];
  let brancas = 0;
  for (const l of linhas) {
    if (l.trim()) {
      if (brancas > MAX_BRANCAS) out.push(`[... ${brancas} linhas em branco ...]`);
      else for (let i = 0; i < brancas; i++) out.push('');
      brancas = 0;
      out.push(l);
    } else brancas++;
  }
  if (brancas > MAX_BRANCAS) out.push(`[... ${brancas} linhas em branco ...]`);
  else for (let i = 0; i < brancas; i++) out.push('');
  return out.join('\n');
}

/** Remove (em vez de mostrar) controles de direção e C1 — para texto que vai ser GUARDADO. */
function semControlesInvisiveis(texto) {
  return String(texto ?? '').replace(/[\u0080-\u009f‪-‮⁦-⁩]/g, '');
}

// Só os que REORDENAM trechos (embedding/override/isolate); as marcas LRM/RLM/ALM são comuns em texto RTL.
const REORDENA = /[‪-‮⁦-⁩]/g;

/**
 * Resposta do modelo (ou relatório de subagente/workflow) impressa no terminal. Um modelo manipulado por uma
 * página ou arquivo podia emitir sequências que o terminal executa: OSC 52 grava na área de transferência
 * (o usuário depois cola um comando que nunca viu), OSC 8 disfarça links, "ESC[2J" limpa a tela. Mais leve
 * que paraExibir: não junta linhas em branco e mantém as marcas de direção comuns. Funciona por pedaço
 * (streaming), porque cada caractere de controle é trocado sozinho.
 */
function paraTerminal(texto) {
  return String(texto ?? '')
    .replace(CONTROLES, (c) => `\\x${hex(c, 2)}`)
    .replace(REORDENA, (c) => `<U+${hex(c, 4)}>`);
}

module.exports = { paraExibir, paraTerminal, semControlesInvisiveis };
