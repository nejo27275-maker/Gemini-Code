// src/planMode.js
// Modo plano com aprovação (v0.14.0): `/plano` deixa o agente SÓ LER e planejar; nada é gravado nem executado
// até você dizer `/aprovar`. A trava é uma allowlist real de ferramentas (a mesma do perfil `plan`), não só um pedido
// no prompt: mesmo que o modelo insista em chamar write_file/run_shell, a execução é recusada.
'use strict';

const { PROFILES } = require('./agentProfiles');

// Perfil plan (leitura) + todo_write (só lista em memória, não toca em disco).
const PLAN_TOOLS = Object.freeze([...PROFILES.plan.tools, 'todo_write']);

const INSTRUCAO = PROFILES.plan.instructions +
  ' MODO PLANO COM APROVAÇÃO: o usuário vai ler o plano e só então dizer /aprovar. Termine SEMPRE com o plano numerado (etapas curtas, ' +
  'arquivos que serão tocados, como será verificado) e pergunte se pode executar. Não peça para o usuário rodar comandos agora.';

/** Interpreta /plano e /aprovar. Devolve null se não for um deles. */
function interpretar(cmd, { ativo = false } = {}) {
  const m = /^\/(plano|aprovar)(?:\s+([\s\S]*))?$/.exec(String(cmd).trim());
  if (!m) return null;
  const arg = (m[2] || '').trim();
  if (m[1] === 'aprovar') {
    if (!ativo) return { acao: 'aviso', aviso: 'Não há plano pendente. Use /plano [pedido] para planejar primeiro.' };
    return { acao: 'aprovar', ativo: false, enviar: mensagemAprovacao(arg) };
  }
  if (/^(off|sair|cancelar)$/i.test(arg)) return { acao: 'sair', ativo: false, aviso: ativo ? 'Modo plano desligado (nada foi executado).' : 'O modo plano já estava desligado.' };
  return { acao: 'entrar', ativo: true, enviar: arg || null, aviso: arg ? null : 'Modo plano ligado: só leitura. Descreva o que quer; /aprovar executa o plano, /plano off cancela.' };
}

function mensagemAprovacao(obs) {
  return `Plano aprovado${obs ? ` com este ajuste: ${obs}` : ''}. Execute-o agora, seguindo as etapas na ordem, rode as verificações e diga exatamente o que foi e o que não foi verificado.`;
}

/** Opções extras para runOnce conforme o modo. */
function opcoes(ativo) {
  return ativo ? { allowedTools: [...PLAN_TOOLS], extraSystemInstruction: INSTRUCAO } : {};
}

module.exports = { PLAN_TOOLS, INSTRUCAO, interpretar, mensagemAprovacao, opcoes };
